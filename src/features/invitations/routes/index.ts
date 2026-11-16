import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

import { invitationDetailDto } from '@/shared/invitation/dtos'
import { openApiDefaultHook } from '@/utils/validation'

import { controller } from '../controllers'
import { tokenParamSchema } from '../schemas'
import { acceptRoutes } from './accept'
import { errorResponse } from './common'
import { declineRoutes } from './decline'
import { signupRoutes } from './signup'

/** GET /invitations/{token}: 招待トークンから招待詳細を取得する（認証不要・招待リンクのpreview用）。 */
const getDetailRoute = createRoute({
  method: 'get',
  path: '/{token}',
  tags: ['Invitations'],
  summary: '招待トークンから招待詳細を取得する',
  request: {
    params: tokenParamSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: invitationDetailDto } },
      description: '招待詳細（organization情報を含む・トークンは含まない）',
    },
    404: errorResponse('招待が見つからない'),
    500: errorResponse('サーバーエラー'),
  },
})

/**
 * 招待関連のルート（/invitations配下）。
 * バリデーションエラー時は defaultHook で既存と同じ `{ error: { message } }`（400）を返す。
 * GET /{token} は認証不要（招待リンクのpreview用）。accept は認証が必要。
 * decline は認証不要（トークンのみで操作）。signup はCookieを設定するためOrigin検証を適用する。
 * `/accept`・`/decline`・`/signup` を `/{token}` より先に登録し、既存の解決結果を維持する。
 */
export const invitationsRoutes = new OpenAPIHono({ defaultHook: openApiDefaultHook })
  .route('/', acceptRoutes)
  .route('/', declineRoutes)
  .route('/', signupRoutes)
  .openapi(getDetailRoute, (c) => controller.getDetail(c, c.req.valid('param').token))
