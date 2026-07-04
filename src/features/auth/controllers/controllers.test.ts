import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import { AppError } from '@/utils/errors'

process.env.JWT_SECRET = 'test-secret'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret'

const signup = mock()
const login = mock()
const refresh = mock()
const logout = mock()
const requestPasswordReset = mock()
const changePassword = mock()
const logoutAll = mock()
const listSessions = mock()
const logoutSession = mock()

await mock.module('../services', () => ({
  authService: { signup, login, refresh, logout, requestPasswordReset, changePassword, logoutAll, listSessions, logoutSession },
}))

const { authController } = await import('.')

/**
 * テスト用アプリ: refresh/logoutはCookieからトークンを取得する。
 * テストではCookieヘッダーを付与してリクエストを送る。
 * AppErrorをstatusCodeへ変換するonErrorを追加する。
 */
const app = new Hono()
  .post('/signup', (c) => authController.signup(c, { name: 'Taro', email: 'taro@example.com', password: 'password123' }))
  .post('/login', (c) => authController.login(c, { email: 'taro@example.com', password: 'password123' }))
  .post('/refresh', (c) => authController.refresh(c))
  .post('/logout', (c) => authController.logout(c))
  .post('/change-password', (c) =>
    authController.changePassword(c, 1, {
      currentPassword: 'current-password-123',
      newPassword: 'new-password-123',
    }),
  )
  .post('/password-reset/request', (c) => authController.requestPasswordReset(c, { email: 'taro@example.com' }))
  .post('/logout-all', (c) => authController.logoutAll(c, 1))
  .get('/sessions', (c) => authController.listSessions(c, 1))
  .delete('/sessions/:id', (c) => authController.logoutSession(c, 1, { id: c.req.param('id') }))
  .onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { message: err.message } }, err.statusCode as ContentfulStatusCode)
    }
    return c.json({ error: { message: 'サーバーエラー' } }, 500)
  })

beforeEach(() => {
  signup.mockReset()
  login.mockReset()
  refresh.mockReset()
  logout.mockReset()
  requestPasswordReset.mockReset()
  changePassword.mockReset()
  logoutAll.mockReset()
  listSessions.mockReset()
  logoutSession.mockReset()
})

describe('authController', () => {
  test('signupはx-forwarded-forの先頭IPをserviceの第2引数へ渡す', async () => {
    signup.mockResolvedValue({
      token: 'access-token',
      refreshToken: 'next-refresh-token',
      user: { id: 1, name: 'Taro', email: 'taro@example.com' },
    })

    const response = await app.request('/signup', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.10, 198.51.100.20' },
    })

    expect(response.status).toBe(201)
    expect(signup).toHaveBeenCalledWith({ name: 'Taro', email: 'taro@example.com', password: 'password123' }, '203.0.113.10')
  })

  test('signupはIPヘッダが無い場合にundefinedをserviceの第2引数へ渡す', async () => {
    signup.mockResolvedValue({
      token: 'access-token',
      refreshToken: 'next-refresh-token',
      user: { id: 1, name: 'Taro', email: 'taro@example.com' },
    })

    const response = await app.request('/signup', { method: 'POST' })

    expect(response.status).toBe(201)
    expect(signup).toHaveBeenCalledWith({ name: 'Taro', email: 'taro@example.com', password: 'password123' }, undefined)
  })

  test('loginはx-forwarded-forの先頭IPをserviceの第2引数へ渡す', async () => {
    login.mockResolvedValue({
      token: 'access-token',
      refreshToken: 'next-refresh-token',
      user: { id: 1, name: 'Taro', email: 'taro@example.com' },
    })

    const response = await app.request('/login', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.10, 198.51.100.20' },
    })

    expect(response.status).toBe(200)
    expect(login).toHaveBeenCalledWith({ email: 'taro@example.com', password: 'password123' }, '203.0.113.10')
  })

  test('loginはIPヘッダが無い場合にundefinedをserviceの第2引数へ渡す', async () => {
    login.mockResolvedValue({
      token: 'access-token',
      refreshToken: 'next-refresh-token',
      user: { id: 1, name: 'Taro', email: 'taro@example.com' },
    })

    const response = await app.request('/login', { method: 'POST' })

    expect(response.status).toBe(200)
    expect(login).toHaveBeenCalledWith({ email: 'taro@example.com', password: 'password123' }, undefined)
  })

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

  test('logoutAllはserviceを呼び出し、Cookieをクリアして204を返す', async () => {
    logoutAll.mockResolvedValue(undefined)

    const response = await app.request('/logout-all', { method: 'POST' })

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(logoutAll).toHaveBeenCalledWith(1)
    expect(response.headers.get('set-cookie')).toContain('refreshToken=')
  })

  test('listSessionsはserviceをuserIdで呼び出し、{ sessions }を200で返す', async () => {
    const createdAt = new Date('2026-06-01T00:00:00.000Z')
    const expiresAt = new Date('2026-07-01T00:00:00.000Z')
    const lastUsedAt = new Date('2026-06-20T00:00:00.000Z')
    listSessions.mockResolvedValue([{ id: 'family-uuid-1', createdAt, expiresAt, lastUsedAt }])

    const response = await app.request('/sessions', { method: 'GET' })

    expect(response.status).toBe(200)
    expect(listSessions).toHaveBeenCalledWith(1)
    const body = (await response.json()) as { sessions?: Array<{ id?: string }> }
    expect(body.sessions).toHaveLength(1)
    expect(body.sessions?.[0].id).toBe('family-uuid-1')
  })

  test('logoutSessionはserviceをuserIdとsessionIdで呼び出し204を返す', async () => {
    logoutSession.mockResolvedValue(undefined)

    const response = await app.request('/sessions/550e8400-e29b-41d4-a716-446655440000', { method: 'DELETE' })

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(logoutSession).toHaveBeenCalledWith(1, '550e8400-e29b-41d4-a716-446655440000')
  })
})
