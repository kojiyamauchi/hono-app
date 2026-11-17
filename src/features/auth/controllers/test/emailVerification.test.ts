import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import { AppError } from '@/utils/errors'

process.env.JWT_SECRET = 'test-secret'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret'

const requestEmailVerification = mock()
const confirmEmailVerification = mock()

await mock.module('../../services/emailVerification', () => ({
  emailVerificationService: { request: requestEmailVerification, confirm: confirmEmailVerification },
}))

const { emailVerificationController } = await import('../emailVerification')

/**
 * テスト用アプリ。AppErrorをstatusCodeへ変換するonErrorを追加する。
 */
const app = new Hono()
  .post('/email-verification/request', (c) => emailVerificationController.request(c, 1))
  .post('/email-verification/confirm', (c) => emailVerificationController.confirm(c, { token: 'verification-token' }))
  .onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { message: err.message } }, err.statusCode as ContentfulStatusCode)
    }
    return c.json({ error: { message: 'サーバーエラー' } }, 500)
  })

beforeEach(() => {
  requestEmailVerification.mockReset()
  confirmEmailVerification.mockReset()
})

describe('emailVerificationController', () => {
  test('email-verification/requestは認証ユーザーIDでserviceを呼び出し202を返す', async () => {
    requestEmailVerification.mockResolvedValue(undefined)

    const response = await app.request('/email-verification/request', { method: 'POST' })

    expect(response.status).toBe(202)
    expect(await response.text()).toBe('')
    expect(requestEmailVerification).toHaveBeenCalledWith(1)
  })

  test('email-verification/confirmはtokenでserviceを呼び出し204を返す', async () => {
    confirmEmailVerification.mockResolvedValue(undefined)

    const response = await app.request('/email-verification/confirm', { method: 'POST' })

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(confirmEmailVerification).toHaveBeenCalledWith('verification-token')
  })
})
