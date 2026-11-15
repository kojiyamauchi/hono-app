import { createRoute, OpenAPIHono } from '@hono/zod-openapi'

import { authMiddleware } from '@/middlewares/auth'
import { organizationMembershipMiddleware } from '@/middlewares/organizationMembership'
import { organizationAdminMiddleware } from '@/middlewares/organizationRole'
import { paramValidationMiddleware } from '@/middlewares/paramValidation'
import { openApiDefaultHook } from '@/utils/validation'

import { auditLogsController } from '../controllers/auditLogs'
import { listDto } from '../dtos/auditLogs'
import { collectionParamSchema, listQuerySchema } from '../schemas/auditLogs'
import { bearerSecurity, errorResponse } from './common'

/**
 * GET /organizations/{id}/audit-logs: 組織の監査ログを新しい順に返す。OWNER / ADMINのみ。
 * 認証 → パス検証 → 所属確認 → ロール確認 → query検証の順に実行する（MEMBERは不正queryでも403）。
 * パス検証は、PostgreSQL INTEGERの上限（2147483647）も検証する監査ログ専用schemaを使う。
 */
const listAuditLogsRoute = createRoute({
  method: 'get',
  path: '/{id}/audit-logs',
  tags: ['Organization Audit Logs'],
  summary: '指定した組織の監査ログ一覧を取得する',
  description:
    'MEMBER_ROLE_CHANGED（ロール変更）、OWNERSHIP_TRANSFERRED（所有権移譲）、MEMBER_REMOVED（管理者によるメンバー削除）、PROJECT_CREATED / PROJECT_UPDATED / PROJECT_DELETED（プロジェクトの作成・更新・削除）を同じ一覧に新しい順（createdAt DESC, id DESC）で返す。AuditLogは action で区別できる6イベントのunionで、必須項目はイベント種別ごとに異なる（メンバー向け項目とプロジェクト向け項目は互いに持たない）。createdAt は記録日時（トランザクション開始時刻）で、一覧順は操作の確定順を保証しない。',
  middleware: [authMiddleware, paramValidationMiddleware(collectionParamSchema), organizationMembershipMiddleware, organizationAdminMiddleware],
  security: bearerSecurity,
  request: {
    params: collectionParamSchema,
    query: listQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: listDto } },
      description: '組織の監査ログ一覧（新しい順、カーソル式ページネーション）',
    },
    400: errorResponse('組織IDまたはqueryが不正'),
    401: errorResponse('認証が必要、またはトークンが無効'),
    403: errorResponse('権限が不足（OWNER / ADMIN のみ閲覧可）'),
    404: errorResponse('組織が見つからない'),
    500: errorResponse('サーバーエラー'),
  },
})

/** 組織の監査ログのルート（`/organizations/{id}/audit-logs`）。 */
export const auditLogsRoutes = new OpenAPIHono({ defaultHook: openApiDefaultHook }).openapi(listAuditLogsRoute, (c) =>
  auditLogsController.list(c, c.req.valid('param').id, c.req.valid('query')),
)
