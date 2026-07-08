import { createMiddleware } from 'hono/factory'

import type { Membership } from '@/shared/membership/entities'
import { membershipRepository } from '@/shared/membership/repositories'
import { AppError } from '@/utils/errors'

/**
 * 組織メンバーシップ検証ミドルウェア。
 * authMiddlewareの後に使用し、パスパラメータ `id` の組織に対して
 * 認証ユーザーがメンバーかを確認する。メンバーであれば membership をcontextに格納する。
 * 非メンバーには組織の存在を隠すため404を返す。
 *
 * OpenAPIHono では route の `middleware` は `request.params` 検証より先に走るため、
 * このミドルウェアより前に `paramValidationMiddleware(<route param schema>)` を差し込み、
 * `id` を含む全パスパラメータを検証済みにしておくこと（不正IDが404へ退行するのを防ぐ）。
 */
export const organizationMembershipMiddleware = createMiddleware<{
  Variables: { userId: number; membership: Membership }
}>(async (c, next) => {
  const userId = c.get('userId')
  const organizationId = Number(c.req.param('id'))

  const membership = await membershipRepository.findByUserAndOrganization(userId, organizationId)
  if (!membership) {
    throw new AppError(404, '組織が見つかりません')
  }

  c.set('membership', membership)
  await next()
})
