import { PrismaPg } from '@prisma/adapter-pg'

import { isSpikeRequestAuthorized } from './spikeAuthorization.mjs'

/** ソケットを開かず、スキーマとWasmのCPU初期化だけを起動時に完了させる。 */
export const createLeanMeasurementWorker = async (Client, compilerBuild) => {
  const startupClient = new Client({
    adapter: new PrismaPg({ connectionString: 'postgresql://unused:unused@127.0.0.1:1/unused', max: 1 }),
    errorFormat: 'minimal',
    queryPlanCacheMaxSize: 0,
  })
  // PrismaPgはqueryまでソケットを作らない。接続リソースはリクエストへ持ち越さない。
  await startupClient.$connect()
  await startupClient.$disconnect()
  let isolateId
  let operationIndex = 0
  return {
    /** 同じ接続を使い回さず、型付きモデルAPIの単一取得を計測する。 */
    async fetch(request, env) {
      if (!isSpikeRequestAuthorized(request, env.SPIKE_TOKEN)) return new Response(null, { status: 401 })
      const url = new URL(request.url)
      if (url.pathname === '/ready') return Response.json({ ok: true, compilerBuild, profile: 'lean' })
      if (!['/measure/ready', '/measure/database-row', '/measure/database'].includes(url.pathname) || request.method !== 'POST')
        return new Response(null, { status: 404 })
      const sample = url.searchParams.get('sample')
      if (!sample || !/^[0-9a-f-]{36}$/.test(sample)) return new Response(null, { status: 400 })
      isolateId ??= crypto.randomUUID()
      const measurement = {
        sample,
        kind: url.pathname.split('/').at(-1),
        isolateId,
        operationIndex: url.pathname === '/measure/ready' ? 0 : ++operationIndex,
        compilerBuild,
        profile: 'lean',
      }
      console.info({ cpuMeasurement: measurement })
      if (url.pathname === '/measure/ready') return Response.json({ ok: true, measurement })
      if (env.ENABLE_DATABASE_CHECK !== 'true') return new Response(null, { status: 404 })
      const prisma = new Client({
        adapter: new PrismaPg({ connectionString: env.HYPERDRIVE.connectionString, max: 1, connectionTimeoutMillis: 10_000 }),
        errorFormat: 'minimal',
        queryPlanCacheMaxSize: 0,
      })
      try {
        const found =
          url.pathname === '/measure/database'
            ? await prisma.user.findUnique({ where: { email: `cloudflare-cpu-${sample}@example.invalid` }, select: { id: true } })
            : await prisma.user.findFirst({ select: { id: true } })
        return Response.json({ ok: true, found: found !== null, measurement })
      } catch {
        return Response.json({ error: 'CHECK_FAILED' }, { status: 500 })
      } finally {
        await prisma.$disconnect()
      }
    },
  }
}
