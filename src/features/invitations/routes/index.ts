import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

import { authMiddleware } from '@/middlewares/auth'
import { originMiddleware } from '@/middlewares/origin'
import { authResultDto } from '@/shared/auth/dtos'
import { invitationDetailDto } from '@/shared/invitation/dtos'
import { memberDto } from '@/shared/membership/dtos'
import { errorResponseDto } from '@/shared/openApi/dtos'
import { SECURITY_SCHEME } from '@/shared/openApi/schemes'
import { openApiDefaultHook } from '@/utils/validation'

import { invitationsController } from '../controllers'
import { acceptInvitationBodySchema, declineInvitationBodySchema, invitationTokenParamSchema, signupInvitationBodySchema } from '../schemas'

/** JSONエラーレスポンス（`{ error: { message } }`）の共通定義を生成する。 */
const errorResponse = (description: string): { content: { 'application/json': { schema: typeof errorResponseDto } }; description: string } => ({
  content: { 'application/json': { schema: errorResponseDto } },
  description,
})

/** アクセストークン（Authorization: Bearer）を要求するendpoint用のsecurity。 */
const bearerSecurity = [{ [SECURITY_SCHEME.bearer]: [] }]

/** GET /invitations/{token}: 招待トークンから招待詳細を取得する（認証不要・招待リンクのpreview用）。 */
const getDetailRoute = createRoute({
  method: 'get',
  path: '/{token}',
  tags: ['Invitations'],
  summary: '招待トークンから招待詳細を取得する',
  request: {
    params: invitationTokenParamSchema,
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

/** POST /invitations/accept: 招待を受諾して組織メンバーになる（認証必要）。 */
const acceptRoute = createRoute({
  method: 'post',
  path: '/accept',
  tags: ['Invitations'],
  summary: '招待トークンを指定して招待を受諾し、組織メンバーになる',
  middleware: [authMiddleware],
  security: bearerSecurity,
  request: {
    body: {
      // required: true を付けないと、Content-Typeなし/bodyなしのPOSTが任意bodyとして
      // 検証スキップされ c.req.valid('json') が {} になり400が返らなくなる。既存の必須body検証を維持する。
      required: true,
      content: { 'application/json': { schema: acceptInvitationBodySchema } },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: memberDto } },
      description: '作成されたmembership',
    },
    400: errorResponse('入力値が不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    403: errorResponse('招待のメールアドレスと認証ユーザーが一致しない'),
    404: errorResponse('招待またはユーザーが見つからない'),
    409: errorResponse('招待が受諾不可（不正ステータス・期限切れ・既にメンバー）'),
    500: errorResponse('サーバーエラー'),
  },
})

/** POST /invitations/decline: 招待を辞退する（認証不要・トークンのみで操作）。 */
const declineRoute = createRoute({
  method: 'post',
  path: '/decline',
  tags: ['Invitations'],
  summary: '招待トークンを指定して招待を辞退する',
  request: {
    body: {
      // required: true を付けないと、Content-Typeなし/bodyなしのPOSTが任意bodyとして
      // 検証スキップされ c.req.valid('json') が {} になり400が返らなくなる。既存の必須body検証を維持する。
      required: true,
      content: { 'application/json': { schema: declineInvitationBodySchema } },
    },
  },
  responses: {
    204: {
      description: '招待を辞退（無内容）',
    },
    400: errorResponse('入力値が不正'),
    404: errorResponse('招待が見つからない'),
    409: errorResponse('招待が辞退不可（不正ステータス・期限切れ・競合）'),
    500: errorResponse('サーバーエラー'),
  },
})

/** POST /invitations/signup: 招待経由で新規登録して組織メンバーになる（認証不要・Cookie設定のためOrigin検証）。 */
const signupRoute = createRoute({
  method: 'post',
  path: '/signup',
  tags: ['Invitations'],
  summary: '招待トークンを指定して新規登録し、組織メンバーになる',
  middleware: [originMiddleware],
  request: {
    body: {
      // required: true を付けないと、Content-Typeなし/bodyなしのPOSTが任意bodyとして
      // 検証スキップされ c.req.valid('json') が {} になり400が返らなくなる。既存の必須body検証を維持する。
      required: true,
      content: { 'application/json': { schema: signupInvitationBodySchema } },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: authResultDto } },
      description: '登録結果（アクセストークンとユーザー情報・リフレッシュトークンはCookie）',
    },
    400: errorResponse('入力値が不正'),
    403: errorResponse('許可されていないOrigin'),
    404: errorResponse('招待が見つからない'),
    409: errorResponse('招待経由の登録不可（不正ステータス・期限切れ・メール重複・競合）'),
    500: errorResponse('サーバーエラー'),
  },
})

/**
 * 招待関連のルート（/invitations配下）。
 * バリデーションエラー時は defaultHook で既存と同じ `{ error: { message } }`（400）を返す。
 * GET /{token} は認証不要（招待リンクのpreview用）。accept は認証が必要。
 * decline は認証不要（トークンのみで操作）。signup はCookieを設定するためOrigin検証を適用する。
 */
export const invitationsRoutes = new OpenAPIHono({ defaultHook: openApiDefaultHook })
  .openapi(getDetailRoute, (c) => invitationsController.getDetail(c, c.req.valid('param').token))
  .openapi(acceptRoute, (c) => invitationsController.accept(c, c.get('userId'), c.req.valid('json')))
  .openapi(declineRoute, (c) => invitationsController.decline(c, c.req.valid('json')))
  .openapi(signupRoute, (c) => invitationsController.signup(c, c.req.valid('json')))
