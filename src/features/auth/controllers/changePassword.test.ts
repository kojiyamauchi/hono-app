import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import { AppError } from '@/utils/errors'

process.env.JWT_SECRET = 'test-secret'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret'

const changePassword = mock()

await mock.module('../services/changePassword', () => ({ changePasswordService: { execute: changePassword } }))

const { changePasswordController } = await import('./changePassword')

/**
 * テスト用アプリ。AppErrorをstatusCodeへ変換するonErrorを追加する。
 */
const app = new Hono()
  .post('/change-password', (c) =>
    changePasswordController.execute(c, 1, {
      currentPassword: 'current-password-123',
      newPassword: 'new-password-123',
    }),
  )
  .onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { message: err.message } }, err.statusCode as ContentfulStatusCode)
    }
    return c.json({ error: { message: 'サーバーエラー' } }, 500)
  })

beforeEach(() => {
  changePassword.mockReset()
})

describe('changePasswordController', () => {
  test('change-passwordはserviceを呼び出し、Cookieをクリアして204を返す', async () => {
    changePassword.mockResolvedValue(undefined)

    const response = await app.request('/change-password', { method: 'POST' })

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(changePassword).toHaveBeenCalledWith(1, 'current-password-123', 'new-password-123')
    expect(response.headers.get('set-cookie')).toContain('refreshToken=')
  })
})
