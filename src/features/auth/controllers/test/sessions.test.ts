import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import { AppError } from '@/utils/errors'

process.env.JWT_SECRET = 'test-secret'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret'

const listSessions = mock()
const logoutSession = mock()

await mock.module('../../services/sessions', () => ({ sessionsService: { list: listSessions, revoke: logoutSession } }))

const { sessionsController } = await import('../sessions')

/**
 * テスト用アプリ。AppErrorをstatusCodeへ変換するonErrorを追加する。
 */
const app = new Hono()
  .get('/sessions', (c) => sessionsController.list(c, 1))
  .delete('/sessions/:id', (c) => sessionsController.revoke(c, 1, { id: c.req.param('id') }))
  .onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { message: err.message } }, err.statusCode as ContentfulStatusCode)
    }
    return c.json({ error: { message: 'サーバーエラー' } }, 500)
  })

beforeEach(() => {
  listSessions.mockReset()
  logoutSession.mockReset()
})

describe('sessionsController', () => {
  test('sessionsController.listはserviceをuserIdで呼び出し、{ sessions }を200で返す', async () => {
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

  test('sessionsController.revokeはserviceをuserIdとsessionIdで呼び出し204を返す', async () => {
    logoutSession.mockResolvedValue(undefined)

    const response = await app.request('/sessions/550e8400-e29b-41d4-a716-446655440000', { method: 'DELETE' })

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(logoutSession).toHaveBeenCalledWith(1, '550e8400-e29b-41d4-a716-446655440000')
  })
})
