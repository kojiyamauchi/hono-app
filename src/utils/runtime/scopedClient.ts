import { AsyncLocalStorage } from 'node:async_hooks'

/** 呼び出したリクエストのクライアントへ委譲し、HTTPのContextを下位層へ渡さない。 */
export const createScopedClient = <T extends object>(createDefault: () => T): { client: T; run: <R>(client: T, callback: () => R) => R } => {
  const storage = new AsyncLocalStorage<T>()
  let defaultClient: T | undefined
  const client = new Proxy({} as T, {
    get: (_target, key): unknown => {
      const current = storage.getStore() ?? (defaultClient ??= createDefault())
      const value = Reflect.get(current, key, current)
      return typeof value === 'function' ? value.bind(current) : value
    },
  })
  return { client, run: (value, callback) => storage.run(value, callback) }
}
