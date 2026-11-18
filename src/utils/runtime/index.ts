import { AsyncLocalStorage } from 'node:async_hooks'

/** 実行環境が提供するパスワード処理。 */
export type PasswordProvider = {
  hash: (password: string) => Promise<string>
  verify: (password: string, hash: string) => Promise<boolean>
}

/** HTTPやDBに依存しない、リクエストごとの環境設定。 */
export type RuntimeScope = {
  env: NodeJS.ProcessEnv
  password: PasswordProvider
  platform: 'cloudflare'
}

const storage = new AsyncLocalStorage<RuntimeScope>()

/** 非同期処理が交互に進んでも、環境値を当該リクエスト内に閉じる。 */
export const runWithRuntime = <T>(scope: RuntimeScope, callback: () => T): T => storage.run(scope, callback)

/** Bunでは従来の環境変数を、Workersではbinding由来の値だけを参照する。 */
export const getEnvironment = (): NodeJS.ProcessEnv => storage.getStore()?.env ?? process.env

/** 実行環境に応じて信頼する転送ヘッダーを切り替える。 */
export const getRuntimePlatform = (): 'cloudflare' | 'bun' => storage.getStore()?.platform ?? 'bun'

/** Bunの既定Argon2idまたは互換性のある実行環境の実装でハッシュ化する。 */
export const hashPassword = (password: string): Promise<string> => storage.getStore()?.password.hash(password) ?? Bun.password.hash(password)

/** 保存済みハッシュを実行環境の実装で照合する。 */
export const verifyPassword = (password: string, hash: string): Promise<boolean> =>
  storage.getStore()?.password.verify(password, hash) ?? Bun.password.verify(password, hash)

/** BunとWorkersで同じ最低応答時間を確保する。 */
export const sleep = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds))
