import type { Request as WorkerRequest, Response as WorkerResponse } from '@cloudflare/workers-types/index'
import { DurableObject } from 'cloudflare:workers'

import worker from '../cloudflare'
import { runCloudflareRequest } from '../libs/cloudflare/runtime'
import { prisma } from '../libs/prisma'
import { getEnvironment, hashPassword, verifyPassword } from '../utils/runtime'

/** 配備対象に含めないworkerd統合検証専用の配線。 */
export { AppExecutor } from '../cloudflare'

/** 同じ本体用の接続ライフサイクルでtransaction・分離・I/O重複を確認する。 */
export class ProbeExecutor extends DurableObject<Record<string, unknown> & { HYPERDRIVE: { connectionString: string } }> {
  async fetch(request: WorkerRequest): Promise<WorkerResponse> {
    const input = (await request.json()) as { operation: string; sample: string; password?: string; hash?: string }
    const result = await runCloudflareRequest({ ...this.env, JWT_SECRET: input.sample }, async () => {
      if (input.operation === 'password') {
        const hash = await hashPassword(input.password!)
        return { verified: await verifyPassword(input.password!, input.hash!), hash }
      }
      if (input.operation === 'wait') {
        const rows = await prisma.$queryRaw<
          { started: number; finished: number }[]
        >`SELECT extract(epoch FROM statement_timestamp())::float8 AS started, extract(epoch FROM clock_timestamp())::float8 AS finished FROM pg_sleep(0.2)`
        return { sample: getEnvironment().JWT_SECRET, interval: rows[0] }
      }
      const email = `${input.sample}@example.invalid`
      const rollback = new Error('検証用のrollback')
      let locked = false
      try {
        await prisma.$transaction(async (tx) => {
          const user = await tx.user.create({ data: { name: 'transaction検証', email, password: 'ログイン不可' } })
          const rows = await tx.$queryRaw<unknown[]>`SELECT id FROM "User" WHERE id=${user.id} FOR UPDATE`
          locked = rows.length === 1
          await tx.user.update({ where: { id: user.id }, data: { name: '更新検証' } })
          throw rollback
        })
      } catch (error) {
        if (error !== rollback) throw error
      }
      const rolledBack = (await prisma.user.count({ where: { email } })) === 0
      let unique = false
      try {
        await prisma.$transaction(async (tx) => {
          const data = { name: '一意制約検証', email, password: 'ログイン不可' }
          await tx.user.create({ data })
          await tx.user.create({ data })
        })
      } catch (error) {
        unique = typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
      }
      return { locked, rolledBack, unique, cleaned: (await prisma.user.count({ where: { email } })) === 0 }
    })
    return Response.json(result) as unknown as WorkerResponse
  }
}

export default {
  /** 検証用APIはこのtest用エントリーポイントでのみ登録する。 */
  fetch(
    request: Request,
    env: Parameters<typeof worker.fetch>[1] & { PROBE: { getByName: (name: string) => { fetch: (request: Request) => Promise<Response> } } },
  ): Promise<Response> {
    if (new URL(request.url).pathname === '/_test/probe') return env.PROBE.getByName('probe').fetch(request)
    return worker.fetch(request, env)
  },
}
