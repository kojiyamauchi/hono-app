import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import { AppError } from '@/utils/errors'

process.env.JWT_SECRET = 'test-secret'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret'

const logout = mock()

await mock.module('../../services/logout', () => ({ logoutService: { execute: logout } }))

const { logoutController } = await import('../logout')

/**
 * テスト用アプリ。AppErrorをstatusCodeへ変換するonErrorを追加する。
 */
const app = new Hono()
  .post('/logout', (c) => logoutController.execute(c))
  .onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { message: err.message } }, err.statusCode as ContentfulStatusCode)
    }
    return c.json({ error: { message: 'サーバーエラー' } }, 500)
  })

beforeEach(() => {
  logout.mockReset()
})

describe('logoutController', () => {
  test('logoutはCookieからトークンを取得してserviceを呼び出し204を返す', async () => {
    logout.mockResolvedValue(undefined)

    const response = await app.request('/logout', {
      method: 'POST',
      headers: { Cookie: 'refreshToken=cookie-refresh-token' },
    })

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(logout).toHaveBeenCalledWith('cookie-refresh-token')
  })

  test('logoutはCookieがなくても204を返す（冪等）', async () => {
    const response = await app.request('/logout', { method: 'POST' })

    expect(response.status).toBe(204)
    expect(logout).not.toHaveBeenCalled()
  })
})
