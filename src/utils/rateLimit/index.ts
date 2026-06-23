/**
 * TTL付きインメモリレート制限ユーティリティ。
 * プロセス内Mapで短期間のカウントを保持するため、再起動や複数インスタンス間では共有されない。
 */

type RateLimitEntry = {
  count: number
  expiresAtMs: number
}

export type RateLimitCheckInput = {
  key: string
  limit: number
  windowMs: number
  nowMs?: number
}

export type RateLimitResult = {
  allowed: boolean
  count: number
  limit: number
  remaining: number
  resetAt: Date
  retryAfterMs: number
}

export type InMemoryRateLimiter = {
  check: (input: RateLimitCheckInput) => RateLimitResult
  reset: () => void
  size: () => number
  sweepExpired: (nowMs?: number) => number
}

/**
 * TTL付きインメモリレートリミッターを作成する。
 * check時に期限切れエントリを掃除し、キーが無制限に残り続けることを防ぐ。
 */
export const createInMemoryRateLimiter = (): InMemoryRateLimiter => {
  const store = new Map<string, RateLimitEntry>()

  const sweepExpired = (nowMs: number = Date.now()): number => {
    let deleted = 0
    for (const [key, entry] of store.entries()) {
      if (entry.expiresAtMs <= nowMs) {
        store.delete(key)
        deleted += 1
      }
    }
    return deleted
  }

  return {
    check: ({ key, limit, windowMs, nowMs = Date.now() }: RateLimitCheckInput): RateLimitResult => {
      if (limit < 1) {
        throw new Error('rate limitのlimitは1以上である必要があります')
      }
      if (windowMs < 1) {
        throw new Error('rate limitのwindowMsは1以上である必要があります')
      }

      sweepExpired(nowMs)

      const current = store.get(key)
      if (!current) {
        const expiresAtMs = nowMs + windowMs
        store.set(key, { count: 1, expiresAtMs })
        return {
          allowed: true,
          count: 1,
          limit,
          remaining: Math.max(limit - 1, 0),
          resetAt: new Date(expiresAtMs),
          retryAfterMs: windowMs,
        }
      }

      const retryAfterMs = Math.max(current.expiresAtMs - nowMs, 0)
      if (current.count >= limit) {
        return {
          allowed: false,
          count: current.count,
          limit,
          remaining: 0,
          resetAt: new Date(current.expiresAtMs),
          retryAfterMs,
        }
      }

      current.count += 1
      return {
        allowed: true,
        count: current.count,
        limit,
        remaining: Math.max(limit - current.count, 0),
        resetAt: new Date(current.expiresAtMs),
        retryAfterMs,
      }
    },
    reset: (): void => {
      store.clear()
    },
    size: (): number => store.size,
    sweepExpired,
  }
}
