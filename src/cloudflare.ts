import type { Request as WorkerRequest, Response as WorkerResponse } from '@cloudflare/workers-types/index'
import { DurableObject } from 'cloudflare:workers'

import { createApp } from './appFactory'
import { type AccessConfig, createAccessVerifier } from './libs/cloudflare/access'
import { runCloudflareRequest } from './libs/cloudflare/runtime'

/** 文字列bindingを環境値として受け取り、接続用bindingは別途扱う。 */
type Bindings = AccessConfig & {
  HYPERDRIVE: { connectionString: string }
  APP_EXECUTOR: { getByName: (name: string) => { fetch: (request: Request) => Promise<Response> } }
  [key: string]: unknown
}

/** SQLite型namespaceを計算の実行場所に使う。永続ストレージへ業務データを保存しない。 */
export class AppExecutor extends DurableObject<Bindings> {
  private application?: ReturnType<typeof createApp>
  private verifyAccess?: ReturnType<typeof createAccessVerifier>

  /** I/O中は他のリクエストを進め、各リクエストの接続は応答前に必ず閉じる。 */
  async fetch(request: WorkerRequest): Promise<WorkerResponse> {
    // 同じworkerdのネイティブオブジェクト。Bun/DOMとWorkersの型定義だけを境界で接続する。
    return (await this.execute(request as unknown as Request)) as unknown as WorkerResponse
  }

  /** アプリ層はBunと共通のFetch API型で扱う。 */
  private async execute(request: Request): Promise<Response> {
    try {
      this.verifyAccess ??= createAccessVerifier(this.env)
      if (!(await this.verifyAccess(request))) return new Response(null, { status: 403 })
      return await runCloudflareRequest(this.env, () => {
        // Node用telemetry初期化・pgの自動計装・OTLP exporterはWorkersでは起動しない。
        this.application ??= createApp({ disableTracing: true })
        return this.application.fetch(request)
      })
    } catch {
      // 例外本文には接続先や資格情報が含まれ得るため、固定メッセージだけを記録する。
      console.error('Cloudflareアプリの実行に失敗しました')
      return Response.json({ error: { message: 'サーバーエラーが発生しました' } }, { status: 500 })
    }
  }
}

export default {
  /** 公開入口は転送だけを行う。全パスのAccess保護に加え、DO内でもJWTを検証する。 */
  fetch(request: Request, env: Bindings): Promise<Response> {
    if (!request.headers.get('cf-access-jwt-assertion')) return Promise.resolve(new Response(null, { status: 403 }))
    // Cloudflareが確定したIPだけをDOへ渡す。利用者のX-Forwarded-Forを信頼しない。
    const headers = new Headers(request.headers)
    headers.delete('x-forwarded-for')
    headers.delete('x-real-ip')
    return env.APP_EXECUTOR.getByName('app').fetch(new Request(request, { headers }))
  },
}
