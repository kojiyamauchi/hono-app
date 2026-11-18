import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from './.wrangler/prisma/client.ts'
import { checkPasswordCompatibility, verifyPasswordOnce } from './password.mjs'
import { verifyPasswordOnceFast } from './passwordFast.mjs'
import { checkPasswordCompatibilityModern, verifyPasswordOnceModern } from './passwordModern.mjs'

let measurementIsolateId
const measurementCounts = new Map()

/** IDだけの取得または合成メールの検索を1回行い、取得した実値を外へ出さない。 */
const readDatabaseOnce = async (connectionString, sample, mode = 'missing') => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 1, connectionTimeoutMillis: 10_000 }), errorFormat: 'minimal' })
  try {
    if (mode === 'wait') {
      // 固定200msの待機を含む読み取り専用SQL。外部入力で待機時間やSQLを変更しない。
      // DB自身の時刻で、異なるリクエストのSQLが実際に重なったかを確認する。
      const rows =
        await prisma.$queryRaw`SELECT extract(epoch FROM statement_timestamp())::float8 AS "startedAt", extract(epoch FROM clock_timestamp())::float8 AS "finishedAt" FROM pg_sleep(0.2)`
      return { ok: rows.length === 1, databaseInterval: rows[0] }
    }
    if (mode === 'raw') {
      const rows = await prisma.$queryRaw`SELECT "id" FROM "User" WHERE "email" = ${`cloudflare-cpu-${sample}@example.invalid`} LIMIT 1`
      return { ok: true, found: rows.length > 0 }
    }
    const found =
      mode === 'missing'
        ? await prisma.user.findUnique({ where: { email: `cloudflare-cpu-${sample}@example.invalid` }, select: { id: true } })
        : await prisma.user.findFirst({ select: { id: true } })
    return { ok: true, found: found !== null }
  } finally {
    await prisma.$disconnect()
  }
}

/** 副作用を残さず、ORM・transaction・行ロック・一意制約を確認する。 */
const checkDatabase = async (connectionString) => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 1, connectionTimeoutMillis: 10_000 }), errorFormat: 'minimal' })
  const email = `cloudflare-check-${crypto.randomUUID()}@example.invalid`
  const rollback = new Error('検証transactionをロールバックします')
  try {
    const ping = await prisma.$queryRaw`SELECT 1 AS ok`
    let transactionVerified = false
    try {
      await prisma.$transaction(
        async (tx) => {
          const user = await tx.user.create({ data: { name: 'Cloudflare接続検証', email, password: '検証専用・ログイン不可' }, select: { id: true } })
          const locked = await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`
          await tx.user.update({ where: { id: user.id }, data: { name: 'Cloudflare更新検証' } })
          const found = await tx.user.findUnique({ where: { id: user.id }, select: { name: true } })
          transactionVerified = locked.length === 1 && found?.name === 'Cloudflare更新検証'
          throw rollback
        },
        { timeout: 15_000 },
      )
    } catch (error) {
      if (error !== rollback) throw error
    }
    const rollbackVerified = (await prisma.user.count({ where: { email } })) === 0
    let uniqueConstraintVerified = false
    try {
      await prisma.$transaction(
        async (tx) => {
          const data = { name: 'Cloudflare一意制約検証', email, password: '検証専用・ログイン不可' }
          await tx.user.create({ data })
          await tx.user.create({ data })
        },
        { timeout: 15_000 },
      )
    } catch (error) {
      if (error.code !== 'P2002') throw error
      uniqueConstraintVerified = true
    }
    return {
      ping: ping[0]?.ok === 1,
      transactionVerified,
      rollbackVerified,
      uniqueConstraintVerified,
      cleanupVerified: (await prisma.user.count({ where: { email } })) === 0,
    }
  } finally {
    try {
      // 想定外の制約不足などでtransactionがcommitされても、今回の検証行だけを削除する。
      await prisma.user.deleteMany({ where: { email } })
    } finally {
      await prisma.$disconnect()
    }
  }
}

export default {
  /** 本番アプリから独立した検証API。秘密値・接続先・例外本文を応答へ含めない。 */
  async fetch(request, env) {
    if (!env.SPIKE_TOKEN || request.headers.get('authorization') !== `Bearer ${env.SPIKE_TOKEN}`) return new Response(null, { status: 401 })
    const path = new URL(request.url).pathname
    try {
      if (
        [
          '/measure/ready',
          '/measure/password',
          '/measure/password-fast',
          '/measure/database',
          '/measure/database-row',
          '/measure/database-raw',
          '/measure/database-wait',
        ].includes(path) &&
        request.method === 'POST'
      ) {
        const sample = new URL(request.url).searchParams.get('sample')
        if (!sample || !/^[0-9a-f-]{36}$/.test(sample)) return new Response(null, { status: 400 })
        const operationIndex = (measurementCounts.get(path) ?? 0) + 1
        measurementCounts.set(path, operationIndex)
        measurementIsolateId ??= crypto.randomUUID()
        const measurement = {
          sample,
          kind: path.split('/').at(-1),
          isolateId: measurementIsolateId,
          operationIndex,
          firstOperationInIsolate: operationIndex === 1,
          scope: env.EXECUTION_SCOPE ?? 'worker',
        }
        // CPU制限で応答できない場合にも、初回かどうかをtailへ残す。秘密値は記録しない。
        console.info({ cpuMeasurement: measurement })
        if (path === '/measure/ready') return Response.json({ ok: true, measurement })
        if (path === '/measure/password' || path === '/measure/password-fast') {
          // 2種類の64MiB級Wasmを同じisolateで初期化しない。比較候補は明示配備時だけ有効化する。
          const native = env.PASSWORD_VERIFIER === 'native'
          if ((path === '/measure/password-fast') !== native) return new Response(null, { status: 404 })
          const body = await request.text()
          if (body.length > 16_384) return new Response(null, { status: 413 })
          const verify = native ? verifyPasswordOnceFast : env.PASSWORD_VERIFIER === 'modern' ? verifyPasswordOnceModern : verifyPasswordOnce
          return Response.json({ verified: await verify(JSON.parse(body)), measurement })
        }
        if (env.ENABLE_DATABASE_CHECK !== 'true') return new Response(null, { status: 404 })
        const mode = { '/measure/database-row': 'row', '/measure/database-raw': 'raw', '/measure/database-wait': 'wait' }[path] ?? 'missing'
        return Response.json({ ...(await readDatabaseOnce(env.HYPERDRIVE.connectionString, sample, mode)), measurement })
      }
      if (path === '/ready' && request.method === 'GET')
        return Response.json({
          ok: true,
          profile: env.EXECUTION_SCOPE === 'durable-object' ? 'durable' : 'standard',
          passwordVerifier: env.PASSWORD_VERIFIER ?? 'legacy',
        })
      if (path === '/password' && request.method === 'POST') {
        if (env.PASSWORD_VERIFIER === 'native') return new Response(null, { status: 404 })
        const body = await request.text()
        if (body.length > 16_384) return new Response(null, { status: 413 })
        const check = env.PASSWORD_VERIFIER === 'modern' ? checkPasswordCompatibilityModern : checkPasswordCompatibility
        return Response.json(await check(JSON.parse(body)))
      }
      if (path === '/database' && request.method === 'POST' && env.ENABLE_DATABASE_CHECK === 'true') {
        return Response.json(await checkDatabase(env.HYPERDRIVE.connectionString))
      }
      return new Response(null, { status: 404 })
    } catch (error) {
      // DBの例外本文には接続先やクエリが含まれ得るため、固定の分類だけを返す。
      const code = typeof error?.code === 'string' && /^P\d{4}$/.test(error.code) ? error.code : 'CHECK_FAILED'
      return Response.json({ error: code }, { status: 500 })
    }
  },
}
