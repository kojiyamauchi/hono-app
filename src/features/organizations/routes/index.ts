import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

import { authMiddleware } from '@/middlewares/auth'
import { organizationMembershipMiddleware } from '@/middlewares/organizationMembership'
import { paramValidationMiddleware } from '@/middlewares/paramValidation'
import { invitationDto } from '@/shared/invitation/dtos'
import { memberDto } from '@/shared/membership/dtos'
import { errorResponseDto } from '@/shared/openApi/dtos'
import { SECURITY_SCHEME } from '@/shared/openApi/schemes'
import { organizationDto } from '@/shared/organization/dtos'
import { openApiDefaultHook } from '@/utils/validation'

import { organizationsController, organizationsInvitationsController, organizationsMembersController } from '../controllers'
import {
  addMemberBodySchema,
  createInvitationBodySchema,
  createOrganizationSchema,
  invitationRouteParamSchema,
  memberRouteParamSchema,
  organizationIdParamSchema,
  updateMemberRoleBodySchema,
  updateOrganizationSchema,
} from '../schemas'

/** JSONエラーレスポンス（`{ error: { message } }`）の共通定義を生成する。 */
const errorResponse = (description: string): { content: { 'application/json': { schema: typeof errorResponseDto } }; description: string } => ({
  content: { 'application/json': { schema: errorResponseDto } },
  description,
})

/** organizations featureの全ルートに共通するsecurity（Bearerアクセストークン）。 */
const bearerSecurity = [{ [SECURITY_SCHEME.bearer]: [] }]

/** POST /organizations: 組織を作成する。 */
const createRouteDef = createRoute({
  method: 'post',
  path: '/',
  tags: ['Organizations'],
  summary: '組織を作成する',
  middleware: [authMiddleware],
  security: bearerSecurity,
  request: {
    body: {
      // required: true を付けないと、Content-Typeなし/bodyなしのPOSTが任意bodyとして
      // 検証スキップされ c.req.valid('json') が {} になり400が返らなくなる。既存の必須body検証を維持する。
      required: true,
      content: { 'application/json': { schema: createOrganizationSchema } },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: organizationDto } },
      description: '作成された組織',
    },
    400: errorResponse('入力値が不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    500: errorResponse('サーバーエラー'),
  },
})

/** GET /organizations: 認証済みユーザーが所属する組織の一覧を返す。 */
const listMineRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Organizations'],
  summary: '認証済みユーザーが所属する組織の一覧を取得する',
  middleware: [authMiddleware],
  security: bearerSecurity,
  responses: {
    200: {
      content: { 'application/json': { schema: organizationDto.array() } },
      description: '所属組織の一覧',
    },
    401: errorResponse('認証が必要、またはトークンが無効'),
    500: errorResponse('サーバーエラー'),
  },
})

/** GET /organizations/{id}: 指定IDの組織情報を返す。 */
const getByIdRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Organizations'],
  summary: '指定した組織の情報を取得する',
  middleware: [authMiddleware, paramValidationMiddleware(organizationIdParamSchema), organizationMembershipMiddleware],
  security: bearerSecurity,
  request: {
    params: organizationIdParamSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: organizationDto } },
      description: '指定組織の情報',
    },
    400: errorResponse('組織IDが不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    404: errorResponse('組織が見つからない'),
    500: errorResponse('サーバーエラー'),
  },
})

/** PATCH /organizations/{id}: 組織を更新する。 */
const updateRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Organizations'],
  summary: '指定した組織を更新する',
  middleware: [authMiddleware, paramValidationMiddleware(organizationIdParamSchema), organizationMembershipMiddleware],
  security: bearerSecurity,
  request: {
    params: organizationIdParamSchema,
    body: {
      // required: true を付けないと、Content-Typeなし/bodyなしのPATCHが任意bodyとして
      // 検証スキップされ c.req.valid('json') が {} になり既存の必須body検証（400）を維持できない。
      required: true,
      content: { 'application/json': { schema: updateOrganizationSchema } },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: organizationDto } },
      description: '更新後の組織情報',
    },
    400: errorResponse('入力値が不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    403: errorResponse('権限が不足'),
    404: errorResponse('組織が見つからない'),
    500: errorResponse('サーバーエラー'),
  },
})

/** DELETE /organizations/{id}: 組織を削除する。 */
const removeRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Organizations'],
  summary: '指定した組織を削除する',
  middleware: [authMiddleware, paramValidationMiddleware(organizationIdParamSchema), organizationMembershipMiddleware],
  security: bearerSecurity,
  request: {
    params: organizationIdParamSchema,
  },
  responses: {
    204: {
      description: '処理を受理',
    },
    400: errorResponse('組織IDが不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    403: errorResponse('権限が不足'),
    404: errorResponse('組織が見つからない'),
    500: errorResponse('サーバーエラー'),
  },
})

/** GET /organizations/{id}/members: 組織のメンバー一覧を返す。 */
const listMembersRoute = createRoute({
  method: 'get',
  path: '/{id}/members',
  tags: ['Organization Members'],
  summary: '指定した組織のメンバー一覧を取得する',
  middleware: [authMiddleware, paramValidationMiddleware(organizationIdParamSchema), organizationMembershipMiddleware],
  security: bearerSecurity,
  request: {
    params: organizationIdParamSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: memberDto.array() } },
      description: '組織のメンバー一覧',
    },
    400: errorResponse('組織IDが不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    404: errorResponse('組織が見つからない'),
    500: errorResponse('サーバーエラー'),
  },
})

/** POST /organizations/{id}/members: メンバーを追加する。 */
const addMemberRoute = createRoute({
  method: 'post',
  path: '/{id}/members',
  tags: ['Organization Members'],
  summary: '指定した組織へメンバーを追加する',
  middleware: [authMiddleware, paramValidationMiddleware(organizationIdParamSchema), organizationMembershipMiddleware],
  security: bearerSecurity,
  request: {
    params: organizationIdParamSchema,
    body: {
      // required: true を付けないと、Content-Typeなし/bodyなしのPOSTが任意bodyとして
      // 検証スキップされ c.req.valid('json') が {} になり既存の必須body検証（400）を維持できない。
      required: true,
      content: { 'application/json': { schema: addMemberBodySchema } },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: memberDto } },
      description: '追加されたメンバー',
    },
    400: errorResponse('入力値が不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    403: errorResponse('権限が不足'),
    404: errorResponse('組織が見つからない'),
    409: errorResponse('既にメンバー'),
    422: errorResponse('意味的に不正な入力（例: OWNERロール指定）'),
    500: errorResponse('サーバーエラー'),
  },
})

/** PATCH /organizations/{id}/members/{membershipId}: メンバーのロールを変更する。 */
const updateMemberRoleRoute = createRoute({
  method: 'patch',
  path: '/{id}/members/{membershipId}',
  tags: ['Organization Members'],
  summary: '指定したメンバーのロールを変更する',
  middleware: [authMiddleware, paramValidationMiddleware(memberRouteParamSchema), organizationMembershipMiddleware],
  security: bearerSecurity,
  request: {
    params: memberRouteParamSchema,
    body: {
      // required: true を付けないと、Content-Typeなし/bodyなしのPATCHが任意bodyとして
      // 検証スキップされ c.req.valid('json') が {} になり既存の必須body検証（400）を維持できない。
      required: true,
      content: { 'application/json': { schema: updateMemberRoleBodySchema } },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: memberDto } },
      description: '変更後のメンバー情報',
    },
    400: errorResponse('入力値が不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    403: errorResponse('権限が不足'),
    404: errorResponse('組織またはメンバーが見つからない'),
    409: errorResponse('対象がOWNERなど変更不可'),
    422: errorResponse('意味的に不正な入力（例: OWNERロール指定）'),
    500: errorResponse('サーバーエラー'),
  },
})

/** DELETE /organizations/{id}/members/{membershipId}: メンバーを削除する。 */
const removeMemberRoute = createRoute({
  method: 'delete',
  path: '/{id}/members/{membershipId}',
  tags: ['Organization Members'],
  summary: '指定したメンバーを削除する',
  middleware: [authMiddleware, paramValidationMiddleware(memberRouteParamSchema), organizationMembershipMiddleware],
  security: bearerSecurity,
  request: {
    params: memberRouteParamSchema,
  },
  responses: {
    204: {
      description: '処理を受理',
    },
    400: errorResponse('パスパラメータが不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    403: errorResponse('権限が不足'),
    404: errorResponse('組織またはメンバーが見つからない'),
    409: errorResponse('対象がOWNERなど削除不可'),
    500: errorResponse('サーバーエラー'),
  },
})

/** GET /organizations/{id}/invitations: 招待一覧を返す。 */
const listInvitationsRoute = createRoute({
  method: 'get',
  path: '/{id}/invitations',
  tags: ['Organization Invitations'],
  summary: '指定した組織の招待一覧を取得する',
  middleware: [authMiddleware, paramValidationMiddleware(organizationIdParamSchema), organizationMembershipMiddleware],
  security: bearerSecurity,
  request: {
    params: organizationIdParamSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: invitationDto.array() } },
      description: '招待の一覧（デフォルトはPENDINGのみ）',
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
  middleware: [authMiddleware, paramValidationMiddleware(organizationIdParamSchema), organizationMembershipMiddleware],
  security: bearerSecurity,
  request: {
    params: organizationIdParamSchema,
    body: {
      // required: true を付けないと、Content-Typeなし/bodyなしのPOSTが任意bodyとして
      // 検証スキップされ c.req.valid('json') が {} になり既存の必須body検証（400）を維持できない。
      required: true,
      content: { 'application/json': { schema: createInvitationBodySchema } },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: invitationDto } },
      description: '作成された招待',
    },
    400: errorResponse('入力値が不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    403: errorResponse('権限が不足'),
    404: errorResponse('組織が見つからない'),
    409: errorResponse('PENDING招待が既に存在'),
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
  middleware: [authMiddleware, paramValidationMiddleware(invitationRouteParamSchema), organizationMembershipMiddleware],
  security: bearerSecurity,
  request: {
    params: invitationRouteParamSchema,
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

/**
 * 組織関連のルート（/organizations配下）。
 * すべて認証が必要。`/:id` 系は組織メンバーシップの確認も行う。
 * バリデーションエラー時は defaultHook で既存と同じ `{ error: { message } }`（400）を返す。
 * 静的パス（`/`）→ `/{id}` → `/{id}/members` 系 → `/{id}/invitations` 系の順で登録する。
 */
export const organizationsRoutes = new OpenAPIHono({ defaultHook: openApiDefaultHook })
  .openapi(createRouteDef, (c) => organizationsController.create(c, c.get('userId'), c.req.valid('json')))
  .openapi(listMineRoute, (c) => organizationsController.listMine(c, c.get('userId')))
  .openapi(getByIdRoute, (c) => organizationsController.getById(c, c.req.valid('param').id))
  .openapi(updateRoute, (c) => organizationsController.update(c, c.req.valid('param').id, c.req.valid('json'), c.get('membership').role))
  .openapi(removeRoute, (c) => organizationsController.remove(c, c.req.valid('param').id, c.get('membership').role))
  .openapi(listMembersRoute, (c) => organizationsMembersController.listMembers(c, c.req.valid('param').id))
  .openapi(addMemberRoute, (c) => organizationsMembersController.addMember(c, c.req.valid('param').id, c.get('membership').role, c.req.valid('json')))
  .openapi(updateMemberRoleRoute, (c) =>
    organizationsMembersController.updateMemberRole(
      c,
      c.req.valid('param').id,
      c.req.valid('param').membershipId,
      c.get('membership').role,
      c.req.valid('json'),
    ),
  )
  .openapi(removeMemberRoute, (c) =>
    organizationsMembersController.removeMember(c, c.req.valid('param').id, c.req.valid('param').membershipId, c.get('membership').role),
  )
  .openapi(listInvitationsRoute, (c) => organizationsInvitationsController.listInvitations(c, c.req.valid('param').id, c.get('membership').role))
  .openapi(createInvitationRoute, (c) =>
    organizationsInvitationsController.createInvitation(c, c.req.valid('param').id, c.get('membership').role, c.req.valid('json')),
  )
  .openapi(cancelInvitationRoute, (c) =>
    organizationsInvitationsController.cancelInvitation(c, c.req.valid('param').id, c.req.valid('param').invitationId, c.get('membership').role),
  )
