import { DurableObject } from 'cloudflare:workers'

import worker from './worker.mjs'

/** 無料のSQLite型namespaceを実行場所として使い、データはSupabaseに置いたままにする。 */
export class CompatibilityExecutor extends DurableObject {
  activeRequests = 0
  serialComparison = Promise.resolve()

  /** 既存のPrismaモデルAPIとArgon2idの処理をCPU時間に余裕のある実行環境へ委譲する。 */
  async fetch(request) {
    const url = new URL(request.url)
    const serial = url.pathname.startsWith('/measure/') && url.searchParams.get('execution') === 'serial'
    /** I/O待ちでは他リクエストの実行を許可し、状態は当該Objectの診断カウンターだけに限定する。 */
    const execute = async () => {
      const activeAtStart = ++this.activeRequests
      try {
        const response = await worker.fetch(request, { ...this.env, EXECUTION_SCOPE: 'durable-object' })
        const sample = url.searchParams.get('sample')
        if (url.pathname.startsWith('/measure/') && /^[0-9a-f-]{36}$/.test(sample ?? '')) {
          console.info({ cpuMeasurement: { sample, scope: 'durable-object', phase: 'complete' } })
        }
        const result = new Response(response.body, response)
        result.headers.set('X-Spike-Execution-Mode', serial ? 'serial' : 'concurrent')
        result.headers.set('X-Spike-Active-Requests', String(activeAtStart))
        result.headers.set('X-Spike-Object-Id', this.ctx.id.toString())
        return result
      } finally {
        this.activeRequests--
      }
    }
    // 過去の直列構成との比較だけに残す。既定経路はリクエスト全体をキューへ入れない。
    // 従来Wasmの計算は同期であり、追加Wasmもハッシュ計算だけに専用キューを持つ。
    if (!serial) return execute()
    const result = this.serialComparison.then(execute)
    this.serialComparison = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

export default {
  /** 入口のWorkerは認証と内部転送だけを行う。Durable Objectに公開URLは作らない。 */
  async fetch(request, env) {
    if (!env.SPIKE_TOKEN || request.headers.get('authorization') !== `Bearer ${env.SPIKE_TOKEN}`) return new Response(null, { status: 401 })
    const url = new URL(request.url)
    if (url.pathname === '/ready' && request.method === 'GET')
      return Response.json({ ok: true, profile: 'durable', passwordVerifier: env.PASSWORD_VERIFIER ?? 'legacy', requestConcurrency: 'concurrent' })
    const sample = url.searchParams.get('sample')
    if (url.pathname.startsWith('/measure/') && /^[0-9a-f-]{36}$/.test(sample ?? '')) {
      console.info({ cpuMeasurement: { sample, scope: 'worker' } })
    }
    // 比較検証用の単一実行先。永続ストレージ・タイマー・常駐接続は利用しない。
    const executor = url.searchParams.get('executor')
    const name = /^[0-9a-f-]{36}$/.test(executor ?? '') ? `cpu-${executor}` : 'compatibility-check'
    return env.COMPATIBILITY_EXECUTOR.getByName(name).fetch(request)
  },
}
