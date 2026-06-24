import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import { AppError } from '@/utils/errors'

process.env.JWT_SECRET = 'test-secret'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret'

const refresh = mock()
const logout = mock()
const requestPasswordReset = mock()
const changePassword = mock()

await mock.module('../services', () => ({
  authService: { refresh, logout, requestPasswordReset, changePassword },
}))

const { authController } = await import('.')

/**
 * テスト用アプリ: refresh/logoutはCookieからトークンを取得する。
 * テストではCookieヘッダーを付与してリクエストを送る。
 * AppErrorをstatusCodeへ変換するonErrorを追加する。
 */
const app = new Hono()
  .post('/refresh', (c) => authController.refresh(c))
  .post('/logout', (c) => authController.logout(c))
  .post('/change-password', (c) =>
    authController.changePassword(c, 1, {
      currentPassword: 'current-password-123',
      newPassword: 'new-password-123',
    }),
  )
  .post('/password-reset/request', (c) => authController.requestPasswordReset(c, { email: 'taro@example.com' }))
  .onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { message: err.message } }, err.statusCode as ContentfulStatusCode)
    }
    return c.json({ error: { message: 'サーバーエラー' } }, 500)
  })

beforeEach(() => {
  refresh.mockReset()
  logout.mockReset()
  requestPasswordReset.mockReset()
  changePassword.mockReset()
})

describe('authController', () => {
  test('refreshはCookieからトークンを取得し、serviceの認証結果のうちアクセストークンとユーザーを200で返す', async () => {
    const result = {
      token: 'access-token',
      refreshToken: 'next-refresh-token',
      user: { id: 1, name: 'Taro', email: 'taro@example.com' },
    }
    refresh.mockResolvedValue(result)

    const response = await app.request('/refresh', {
      method: 'POST',
      headers: { Cookie: 'refreshToken=cookie-refresh-token' },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { token?: string; refreshToken?: string; user?: { id?: number } }
    expect(body.token).toBe('access-token')
    // bodyにrefreshTokenが含まれないことを確認する
    expect(body.refreshToken).toBeUndefined()
    expect(body.user?.id).toBe(1)
    expect(refresh).toHaveBeenCalledWith('cookie-refresh-token')
  })

  test('refreshはCookieがない場合に401を返す', async () => {
    const response = await app.request('/refresh', { method: 'POST' })

    expect(response.status).toBe(401)
    expect(refresh).not.toHaveBeenCalled()
  })

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

  test('change-passwordはserviceを呼び出し、Cookieをクリアして204を返す', async () => {
    changePassword.mockResolvedValue(undefined)

    const response = await app.request('/change-password', { method: 'POST' })

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(changePassword).toHaveBeenCalledWith(1, 'current-password-123', 'new-password-123')
    expect(response.headers.get('set-cookie')).toContain('refreshToken=')
  })

  test('password-reset/requestはx-forwarded-forの先頭IPをserviceへ渡す', async () => {
    requestPasswordReset.mockResolvedValue(undefined)

    const response = await app.request('/password-reset/request', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.10, 198.51.100.20' },
    })

    expect(response.status).toBe(202)
    expect(requestPasswordReset).toHaveBeenCalledWith('taro@example.com', '203.0.113.10')
  })

  test('password-reset/requestはx-forwarded-forが無い場合にx-real-ipをserviceへ渡す', async () => {
    requestPasswordReset.mockResolvedValue(undefined)

    const response = await app.request('/password-reset/request', {
      method: 'POST',
      headers: { 'x-real-ip': '198.51.100.20' },
    })

    expect(response.status).toBe(202)
    expect(requestPasswordReset).toHaveBeenCalledWith('taro@example.com', '198.51.100.20')
  })

  test('password-reset/requestはIPヘッダが無い場合にundefinedをserviceへ渡す', async () => {
    requestPasswordReset.mockResolvedValue(undefined)

    const response = await app.request('/password-reset/request', { method: 'POST' })

    expect(response.status).toBe(202)
    expect(requestPasswordReset).toHaveBeenCalledWith('taro@example.com', undefined)
  })
})
