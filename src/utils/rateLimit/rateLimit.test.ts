import { describe, expect, test } from 'bun:test'

import { createInMemoryRateLimiter } from '.'

describe('createInMemoryRateLimiter', () => {
  test('閾値未満なら許可し、残り回数を返す', () => {
    const limiter = createInMemoryRateLimiter()

    const first = limiter.check({ key: 'ip:127.0.0.1', limit: 2, windowMs: 1_000, nowMs: 1_000 })
    const second = limiter.check({ key: 'ip:127.0.0.1', limit: 2, windowMs: 1_000, nowMs: 1_100 })

    expect(first.allowed).toBe(true)
    expect(first.remaining).toBe(1)
    expect(second.allowed).toBe(true)
    expect(second.remaining).toBe(0)
  })

  test('閾値超過なら拒否し、カウントを増やさない', () => {
    const limiter = createInMemoryRateLimiter()

    limiter.check({ key: 'email:hash', limit: 1, windowMs: 1_000, nowMs: 1_000 })
    const limited = limiter.check({ key: 'email:hash', limit: 1, windowMs: 1_000, nowMs: 1_100 })

    expect(limited.allowed).toBe(false)
    expect(limited.count).toBe(1)
    expect(limited.remaining).toBe(0)
    expect(limited.retryAfterMs).toBe(900)
  })

  test('期限を過ぎたら再度許可される', () => {
    const limiter = createInMemoryRateLimiter()

    limiter.check({ key: 'ip:127.0.0.1', limit: 1, windowMs: 1_000, nowMs: 1_000 })
    const allowed = limiter.check({ key: 'ip:127.0.0.1', limit: 1, windowMs: 1_000, nowMs: 2_001 })

    expect(allowed.allowed).toBe(true)
    expect(allowed.count).toBe(1)
    expect(allowed.resetAt.getTime()).toBe(3_001)
  })

  test('check時に期限切れエントリを掃除し、storeが増え続けないようにする', () => {
    const limiter = createInMemoryRateLimiter()

    limiter.check({ key: 'ip:old-1', limit: 1, windowMs: 1_000, nowMs: 1_000 })
    limiter.check({ key: 'ip:old-2', limit: 1, windowMs: 1_000, nowMs: 1_000 })
    expect(limiter.size()).toBe(2)

    limiter.check({ key: 'ip:new', limit: 1, windowMs: 1_000, nowMs: 2_001 })

    expect(limiter.size()).toBe(1)
  })

  test('sweepExpiredで期限切れエントリ数を返す', () => {
    const limiter = createInMemoryRateLimiter()

    limiter.check({ key: 'ip:old', limit: 1, windowMs: 1_000, nowMs: 1_000 })
    limiter.check({ key: 'ip:active', limit: 1, windowMs: 2_000, nowMs: 1_000 })

    const deleted = limiter.sweepExpired(2_001)

    expect(deleted).toBe(1)
    expect(limiter.size()).toBe(1)
  })

  test('不正なlimitやwindowMsはエラーにする', () => {
    const limiter = createInMemoryRateLimiter()

    expect(() => limiter.check({ key: 'ip:127.0.0.1', limit: 0, windowMs: 1_000 })).toThrow('limitは1以上')
    expect(() => limiter.check({ key: 'ip:127.0.0.1', limit: 1, windowMs: 0 })).toThrow('windowMsは1以上')
  })
})
