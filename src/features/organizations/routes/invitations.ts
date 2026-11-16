import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

import { authMiddleware } from '@/middlewares/auth'
import { organizationMembershipMiddleware } from '@/middlewares/organizationMembership'
import { paramValidationMiddleware } from '@/middlewares/paramValidation'
import { invitationDto, invitationListItemDto } from '@/shared/invitation/dtos'
import { openApiDefaultHook } from '@/utils/validation'

import { invitationsController } from '../controllers/invitations'
import { idParamSchema } from '../schemas/common'
import { createBodySchema, itemParamSchema } from '../schemas/invitations'
import { bearerSecurity, errorResponse } from './common'

/** GET /organizations/{id}/invitations: 招待一覧を返す。 */
const listInvitationsRoute = createRoute({
  method: 'get',
  path: '/{id}/invitations',
  tags: ['Organization Invitations'],
  summary: '指定した組織の招待一覧を取得する',
  middleware: [authMiddleware, paramValidationMiddleware(idParamSchema), organizationMembershipMiddleware],
  security: bearerSecurity,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: invitationListItemDto.array() } },
      description: '招待の一覧（デフォルトはPENDINGのみ）。各要素に招待メール配信状態 emailDeliveryStatus を含む（配信記録なしはnull）',
    },
    400: errorResponse('組織IDが不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    403: errorResponse('権限が不足'),
    404: errorResponse('組織が見つからない'),
    500: errorResponse('サーバーエラー'),
  },
})

/** POST /organizations/{id}/invitations: 招待を作成する。 */
const createInvitationRoute = createRoute({
  method: 'post',
  path: '/{id}/invitations',
  tags: ['Organization Invitations'],
  summary: '指定した組織への招待を作成する',
  middleware: [authMiddleware, paramValidationMiddleware(idParamSchema), organizationMembershipMiddleware],
  security: bearerSecurity,
  request: {
    params: idParamSchema,
    body: {
      // required: true を付けないと、Content-Typeなし/bodyなしのPOSTが任意bodyとして
      // 検証スキップされ c.req.valid('json') が {} になり既存の必須body検証（400）を維持できない。
      required: true,
      content: { 'application/json': { schema: createBodySchema } },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: invitationDto } },
      description: '作成された招待。メール配信有効時は配信待ちの保存までを示す。',
    },
    400: errorResponse('入力値が不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    403: errorResponse('権限が不足'),
    404: errorResponse('組織が見つからない'),
    409: errorResponse('PENDING招待が作成済み、または既に組織のメンバー'),
    422: errorResponse('意味的に不正な入力（例: OWNERロール指定）'),
    500: errorResponse('サーバーエラー'),
  },
})

/** DELETE /organizations/{id}/invitations/{invitationId}: 招待をキャンセルする。 */
const cancelInvitationRoute = createRoute({
  method: 'delete',
  path: '/{id}/invitations/{invitationId}',
  tags: ['Organization Invitations'],
  summary: '指定した招待をキャンセルする',
  middleware: [authMiddleware, paramValidationMiddleware(itemParamSchema), organizationMembershipMiddleware],
  security: bearerSecurity,
  request: {
    params: itemParamSchema,
  },
  responses: {
    204: {
      description: '処理を受理',
    },
    400: errorResponse('パスパラメータが不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    403: errorResponse('権限が不足'),
    404: errorResponse('組織または招待が見つからない'),
    409: errorResponse('PENDING以外は キャンセル不可'),
    500: errorResponse('サーバーエラー'),
  },
})

/** POST /organizations/{id}/invitations/{invitationId}/resend-email: 招待メールの再送を受け付ける。 */
const resendInvitationEmailRoute = createRoute({
  method: 'post',
  path: '/{id}/invitations/{invitationId}/resend-email',
  tags: ['Organization Invitations'],
  summary: '指定した招待のメール再送を受け付ける',
  description:
    '再送できるのは、ENABLE_INVITATION_EMAIL=true で配信設定が有効な環境で、DB上のPENDINGの招待かつ有効期限が判定時刻より後（同時刻は期限切れ）であり、初回の配信がResendに明示的に拒否された（REJECTED かつ受付結果不明でなく、原因が client または rate_limited の）場合に限る。受け付けは招待ごとに1回だけ。権限は OWNER が ADMIN／MEMBER 宛て、ADMIN が MEMBER 宛てで、MEMBER は不可（OWNER 宛ては不可）。所属・ロール・招待・配信の状態はロックを取得した後の最新の値で判定する。202は配信待ちの保存までを示し、Resendの受付や受信者への配達を保証しない。GCP devでは既存の手動Jobを実行した後に、招待一覧の emailDeliveryStatus で状態を確認する。応答を受け取れなかった場合は同じ依頼を再送し、202または「再送は既に受け付けています」の409で受付を確認する。',
  // 所属・ロールの認可は、Serviceがrepositoryのロック後に読み直した値で行うため、organizationMembershipMiddlewareは使わない。
  middleware: [authMiddleware, paramValidationMiddleware(itemParamSchema)],
  security: bearerSecurity,
  request: {
    params: itemParamSchema,
  },
  responses: {
    202: {
      description: '再送の配信待ちを保存した（本文なし）',
    },
    400: errorResponse('パスパラメータが不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    403: errorResponse('権限が不足（ロック後のロールがMEMBER、または宛先ロールへの再送権限がない。ADMINによるADMIN宛て、OWNER宛てを含む）'),
    404: errorResponse('組織・招待が見つからない、または（ロック後に）所属していない'),
    409: errorResponse('配信設定が無効、招待が無効または期限切れ、配信が再送対象外、または再送済み'),
    500: errorResponse('サーバーエラー（配信設定の不備、保存失敗など）'),
  },
})

/** 組織の招待のルート（`/organizations/{id}/invitations` 配下）。 */
export const invitationsRoutes = new OpenAPIHono({ defaultHook: openApiDefaultHook })
  .openapi(listInvitationsRoute, (c) => invitationsController.list(c, c.req.valid('param').id, c.get('membership').role))
  .openapi(createInvitationRoute, (c) => invitationsController.create(c, c.req.valid('param').id, c.get('membership').role, c.req.valid('json')))
  .openapi(cancelInvitationRoute, (c) => invitationsController.cancel(c, c.req.valid('param').id, c.req.valid('param').invitationId, c.get('membership').role))
  .openapi(resendInvitationEmailRoute, (c) => invitationsController.resendEmail(c, c.req.valid('param').id, c.req.valid('param').invitationId, c.get('userId')))
