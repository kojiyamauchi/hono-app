import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import { AppError } from '@/utils/errors'

process.env.JWT_SECRET = 'test-secret'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret'

const logoutAll = mock()

await mock.module('../../services/logoutAll', () => ({ logoutAllService: { execute: logoutAll } }))

const { logoutAllController } = await import('../logoutAll')

/**
 * テスト用アプリ。AppErrorをstatusCodeへ変換するonErrorを追加する。
 */
const app = new Hono()
  .post('/logout-all', (c) => logoutAllController.execute(c, 1))
  .onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { message: err.message } }, err.statusCode as ContentfulStatusCode)
    }
    return c.json({ error: { message: 'サーバーエラー' } }, 500)
  })

beforeEach(() => {
  logoutAll.mockReset()
})

describe('logoutAllController', () => {
  test('logoutAllはserviceを呼び出し、Cookieをクリアして204を返す', async () => {
    logoutAll.mockResolvedValue(undefined)

    const response = await app.request('/logout-all', { method: 'POST' })

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(logoutAll).toHaveBeenCalledWith(1)
    expect(response.headers.get('set-cookie')).toContain('refreshToken=')
  })
})
