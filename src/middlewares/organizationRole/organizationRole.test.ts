import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import type { Membership, Role } from '@/shared/membership/entities'
import { AppError } from '@/utils/errors'

import { organizationAdminMiddleware } from '.'

/**
 * テスト用アプリ: 所属確認済みの状態（contextのmembership）を再現してから、ロール確認を経由する。
 * AppErrorをstatusCodeに変換するonErrorハンドラを追加する。
 */
const createApp = (membership: Membership | null): Hono<{ Variables: { membership: Membership } }> =>
  new Hono<{ Variables: { membership: Membership } }>()
    .use('*', async (c, next) => {
      if (membership) {
        c.set('membership', membership)
      }
      await next()
    })
    .get('/test', organizationAdminMiddleware, (c) => c.json({ ok: true }, 200))
    .onError((err, c) => {
      if (err instanceof AppError) {
        return c.json({ error: { message: err.message } }, err.statusCode as ContentfulStatusCode)
      }
      return c.json({ error: { message: 'サーバーエラー' } }, 500)
    })

const membershipWithRole = (role: Role): Membership => ({
  id: 1,
  userId: 1,
  organizationId: 1,
  role,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
})

describe('organizationAdminMiddleware', () => {
  test.each<Role>(['OWNER', 'ADMIN'])('%sは通す', async (role) => {
    const response = await createApp(membershipWithRole(role)).request('/test')

    expect(response.status).toBe(200)
  })

  test('MEMBERは403を返す', async () => {
    const response = await createApp(membershipWithRole('MEMBER')).request('/test')

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: { message: 'この操作には管理者以上の権限が必要です' } })
  })
})
