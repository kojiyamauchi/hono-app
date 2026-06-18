import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { Hono } from 'hono'

const refresh = mock()
const logout = mock()

await mock.module('../services', () => ({
  authService: { refresh, logout },
}))

const { authController } = await import('.')

const app = new Hono()
  .post('/refresh', (c) => authController.refresh(c, { refreshToken: 'refresh-token' }))
  .post('/logout', (c) => authController.logout(c, { refreshToken: 'refresh-token' }))

beforeEach(() => {
  refresh.mockReset()
  logout.mockReset()
})

describe('authController', () => {
  test('refreshはserviceの認証結果を200で返す', async () => {
    const result = {
      token: 'access-token',
      refreshToken: 'next-refresh-token',
      user: { id: 1, name: 'Taro', email: 'taro@example.com' },
    }
    refresh.mockResolvedValue(result)

    const response = await app.request('/refresh', { method: 'POST' })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(result)
    expect(refresh).toHaveBeenCalledWith('refresh-token')
  })

  test('logoutはserviceを呼び出して204を返す', async () => {
    logout.mockResolvedValue(undefined)

    const response = await app.request('/logout', { method: 'POST' })

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(logout).toHaveBeenCalledWith('refresh-token')
  })
})
