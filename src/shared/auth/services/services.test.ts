import { describe, expect, test } from 'bun:test'
import { decode } from 'hono/jwt'

process.env.JWT_SECRET = 'test-jwt-secret'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret'
process.env.PASSWORD_RESET_TOKEN_SECRET = 'test-password-reset-secret'

const {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_MS,
  PASSWORD_RESET_TOKEN_TTL_MS,
  hashRefreshToken,
  issueAuthToken,
  issueRefreshToken,
  hashPasswordResetToken,
  issuePasswordResetToken,
} = await import('.')

describe('issueAuthToken', () => {
  test('15分後に期限切れになるアクセストークンを発行する', async () => {
    const before = Math.floor(Date.now() / 1000)
    const token = await issueAuthToken(10)
    const { payload } = decode(token)

    expect(payload.sub).toBe(10)
    expect(payload.exp).toBeGreaterThanOrEqual(before + ACCESS_TOKEN_TTL_SECONDS)
    expect(payload.exp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS)
  })
})

describe('hashRefreshToken', () => {
  test('同じトークンから同じHMACを生成する', () => {
    const first = hashRefreshToken('refresh-token')
    const second = hashRefreshToken('refresh-token')

    expect(first).toBe(second)
    expect(first).not.toBe('refresh-token')
    expect(first).toHaveLength(64)
  })
})

describe('issueRefreshToken', () => {
  test('新しいfamilyと14日後の有効期限を持つトークンを発行する', () => {
    const before = Date.now()
    const result = issueRefreshToken()

    expect(result.token).not.toBe(result.tokenHash)
    expect(result.tokenHash).toBe(hashRefreshToken(result.token))
    expect(result.familyId).not.toBeEmpty()
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + REFRESH_TOKEN_TTL_MS)
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + REFRESH_TOKEN_TTL_MS)
  })

  test('指定したfamilyを引き継ぎ、毎回異なるトークンを発行する', () => {
    const first = issueRefreshToken('family-id')
    const second = issueRefreshToken('family-id')

    expect(first.familyId).toBe('family-id')
    expect(second.familyId).toBe('family-id')
    expect(first.token).not.toBe(second.token)
    expect(first.tokenHash).not.toBe(second.tokenHash)
  })
})

describe('hashPasswordResetToken', () => {
  test('同じtoken/secretで同じHMAC、異なるtokenで異なるHMACを生成する', () => {
    expect(hashPasswordResetToken('reset-token')).toBe(hashPasswordResetToken('reset-token'))
    expect(hashPasswordResetToken('reset-token')).not.toBe(hashPasswordResetToken('other-token'))
    expect(hashPasswordResetToken('reset-token')).toHaveLength(64)
    expect(hashPasswordResetToken('reset-token')).not.toBe('reset-token')
  })

  test('専用鍵を使う（リフレッシュトークンのHMACとは異なる）', () => {
    expect(hashPasswordResetToken('same-token')).not.toBe(hashRefreshToken('same-token'))
  })

  test('PASSWORD_RESET_TOKEN_SECRET未設定時はエラーを投げる', () => {
    const original = process.env.PASSWORD_RESET_TOKEN_SECRET
    delete process.env.PASSWORD_RESET_TOKEN_SECRET
    try {
      expect(() => hashPasswordResetToken('reset-token')).toThrow()
    } finally {
      process.env.PASSWORD_RESET_TOKEN_SECRET = original
    }
  })
})

describe('issuePasswordResetToken', () => {
  test('32バイト相当のbase64urlトークンを発行し、tokenHashが対応する', () => {
    const result = issuePasswordResetToken()

    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/) // 32バイトのbase64url（パディングなし）
    expect(result.tokenHash).toBe(hashPasswordResetToken(result.token))
    expect(result.token).not.toBe(result.tokenHash)
  })

  test('連続発行でトークンが重複しない', () => {
    const first = issuePasswordResetToken()
    const second = issuePasswordResetToken()

    expect(first.token).not.toBe(second.token)
    expect(first.tokenHash).not.toBe(second.tokenHash)
  })

  test('発行時刻から約PASSWORD_RESET_TOKEN_TTL_MS後の有効期限を持つ', () => {
    const before = Date.now()
    const result = issuePasswordResetToken()

    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + PASSWORD_RESET_TOKEN_TTL_MS)
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS)
  })
})
