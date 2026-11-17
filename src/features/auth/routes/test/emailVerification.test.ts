import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { sign } from 'hono/jwt'

import type { EmailVerificationToken } from '@/shared/auth/entities/emailVerification'

import { createRouteTestContext, createUserFixture } from './testSupport'

const context = await createRouteTestContext()
const { app } = context
const { findByTokenHash: evtFindByTokenHash, confirm: evtConfirm } = context.mocks.emailVerificationTokens
const { findById } = context.mocks.users
const { sendEmailVerificationBestEffort } = context.mocks.emailVerification
const { emailVerificationRequestRateLimiter } = await import('../../services/emailVerification')

const user = createUserFixture()

const emailVerificationToken: EmailVerificationToken = {
  id: 30,
  userId: 1,
  tokenHash: 'hashed-email-verification-token',
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  usedAt: null,
  createdAt: new Date('2026-06-18T00:00:00.000Z'),
}

beforeEach(() => {
  context.reset()
  emailVerificationRequestRateLimiter.reset()
})

afterEach(() => {
  context.assertNoUnexpectedCalls()
})

afterAll(() => {
  context.cleanup()
})

const createAccessToken = async (userId: number): Promise<string> => {
  return sign({ sub: userId, exp: Math.floor(Date.now() / 1000) + 60 }, 'test-secret')
}

describe('POST /auth/email-verification/request', () => {
  test('認証済みの未検証ユーザーなら202を返す', async () => {
    const token = await createAccessToken(1)
    findById.mockResolvedValue(user)

    const response = await app.request('/auth/email-verification/request', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(202)
    expect(await response.text()).toBe('')
    expect(sendEmailVerificationBestEffort).toHaveBeenCalledWith(1, 'taro@example.com')
  })

  test('未認証なら401を返す', async () => {
    const response = await app.request('/auth/email-verification/request', { method: 'POST' })

    expect(response.status).toBe(401)
    expect(sendEmailVerificationBestEffort).not.toHaveBeenCalled()
  })

  test('検証済みユーザーなら409を返す', async () => {
    const token = await createAccessToken(1)
    findById.mockResolvedValue({ ...user, emailVerifiedAt: new Date() })

    const response = await app.request('/auth/email-verification/request', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(409)
    expect(sendEmailVerificationBestEffort).not.toHaveBeenCalled()
  })

  test('ユーザー単位のrate limit超過時は429を返す', async () => {
    const token = await createAccessToken(1)
    findById.mockResolvedValue(user)
    const infoSpy = spyOn(console, 'info').mockImplementation(() => {})

    try {
      for (let i = 0; i < 3; i++) {
        const response = await app.request('/auth/email-verification/request', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
        expect(response.status).toBe(202)
      }

      const response = await app.request('/auth/email-verification/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(response.status).toBe(429)
    } finally {
      infoSpy.mockRestore()
    }
  })

  test('許可されていないOriginなら403を返す', async () => {
    const token = await createAccessToken(1)

    const response = await app.request('/auth/email-verification/request', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Origin: 'http://evil.com' },
    })

    expect(response.status).toBe(403)
    expect(findById).not.toHaveBeenCalled()
  })
})

describe('POST /auth/email-verification/confirm', () => {
  test('有効なトークンなら204を返す', async () => {
    evtFindByTokenHash.mockResolvedValue(emailVerificationToken)
    evtConfirm.mockResolvedValue(true)

    const response = await app.request('/auth/email-verification/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'valid-verification-token' }),
    })

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(evtConfirm).toHaveBeenCalledWith(30, 1)
  })

  test('無効・期限切れ・使用済みトークンは401を返す', async () => {
    evtFindByTokenHash.mockResolvedValueOnce(null)
    const invalid = await app.request('/auth/email-verification/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'invalid-token' }),
    })

    evtFindByTokenHash.mockResolvedValueOnce({ ...emailVerificationToken, expiresAt: new Date(Date.now() - 1) })
    const expired = await app.request('/auth/email-verification/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'expired-token' }),
    })

    evtFindByTokenHash.mockResolvedValueOnce({ ...emailVerificationToken, usedAt: new Date() })
    const used = await app.request('/auth/email-verification/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'used-token' }),
    })

    expect(invalid.status).toBe(401)
    expect(expired.status).toBe(401)
    expect(used.status).toBe(401)
  })

  test('tokenが空またはbodyなしなら400を返す', async () => {
    const emptyToken = await app.request('/auth/email-verification/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: '' }),
    })
    const noBody = await app.request('/auth/email-verification/confirm', { method: 'POST' })

    expect(emptyToken.status).toBe(400)
    expect(noBody.status).toBe(400)
    expect(evtFindByTokenHash).not.toHaveBeenCalled()
  })
})
