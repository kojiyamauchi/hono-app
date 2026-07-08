import { createMiddleware } from 'hono/factory'
import { z } from 'zod'

import type { Membership } from '@/shared/membership/entities'
import { membershipRepository } from '@/shared/membership/repositories'
import { AppError } from '@/utils/errors'

/**
 * パスパラメータ `id`（組織ID）の検証スキーマ。
 * OpenAPIHono では route の `middleware` が `request.params` の検証より先に実行されるため、
 * このミドルウェア内でも id を検証しないと、不正な id（非数値など）が `NaN` のまま
 * repositoryへ渡り、本来400であるべき不正IDが404になってしまう（挙動退行）。
 * 検証規則・エラーメッセージは各featureの `organizationIdParamSchema` と揃えること。
 */
const organizationIdSchema = z.coerce.number().int('組織IDは整数で指定してください').positive('組織IDは1以上で指定してください')

/**
 * 組織メンバーシップ検証ミドルウェア。
 * authMiddlewareの後に使用し、パスパラメータ `id` の組織に対して
 * 認証ユーザーがメンバーかを確認する。メンバーであれば membership をcontextに格納する。
 * 不正なIDは400、非メンバーには組織の存在を隠すため404を返す。
 */
export const organizationMembershipMiddleware = createMiddleware<{
  Variables: { userId: number; membership: Membership }
}>(async (c, next) => {
  const userId = c.get('userId')

  // route.middleware は param検証より先に走るため、ここで先に id を検証して不正IDを400で弾く。
  // メッセージ形式は onValidationError / openApiDefaultHook と同じ issues[0].message を踏襲する。
  const parsedId = organizationIdSchema.safeParse(c.req.param('id'))
  if (!parsedId.success) {
    throw new AppError(400, parsedId.error.issues[0]?.message ?? '入力値が正しくありません')
  }
  const organizationId = parsedId.data

  const membership = await membershipRepository.findByUserAndOrganization(userId, organizationId)
  if (!membership) {
    throw new AppError(404, '組織が見つかりません')
  }

  c.set('membership', membership)
  await next()
})
