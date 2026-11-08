import { createMiddleware } from 'hono/factory'

import type { Membership } from '@/shared/membership/entities'
import { AppError } from '@/utils/errors'

/**
 * 組織の管理者以上（OWNER / ADMIN）を要求するミドルウェア。
 * `organizationMembershipMiddleware` の後に使用し、contextの `membership.role` がOWNER・ADMIN以外（MEMBER）なら403を返す。
 *
 * OpenAPIHono では route の `middleware` は `request.query` などの検証より先に走るため、
 * このミドルウェアで拒否されたMEMBERには、不正なqueryを送っても400ではなく403が返る
 * （認証 → パス検証 → 所属確認 → ロール確認 → query検証の順）。
 */
export const organizationAdminMiddleware = createMiddleware<{
  Variables: { membership: Membership }
}>(async (c, next) => {
  const { role } = c.get('membership')
  if (role !== 'OWNER' && role !== 'ADMIN') {
    throw new AppError(403, 'この操作には管理者以上の権限が必要です')
  }

  await next()
})
