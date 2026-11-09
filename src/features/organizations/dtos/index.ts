import { z } from '@hono/zod-openapi'

import { memberDto } from '@/shared/membership/dtos'
import { roleValues } from '@/shared/membership/entities'
import { organizationDto } from '@/shared/organization/dtos'

import { auditActionValues } from '../entities'

/**
 * GET /organizations/{id}/members の応答DTO（カーソル式ページネーション）。
 * 次ページの有無は `nextCursor !== null` で表すため、limitのエコーとhasNextは持たない。
 * OpenAPI response schemaとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const memberListDto = z.object({ items: z.array(memberDto), nextCursor: z.string().nullable() }).openapi('MemberList')

/**
 * GET /organizations の応答DTO（オフセット式ページネーション）。
 * 数値による位置（limit・offset）と後続の有無（hasNext）を返す。
 * OpenAPI response schemaとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const organizationListDto = z
  .object({ items: z.array(organizationDto), limit: z.number().int(), offset: z.number().int(), hasNext: z.boolean() })
  .openapi('OrganizationList')

/**
 * APIレスポンス用の監査ログDTO。
 * `action` と `previousRole` / `newRole` の列挙値はentity側を正本とする。
 * `createdAt` はJSONレスポンス上のISO 8601日時文字列として扱う。
 * 氏名・メールアドレスなどは含めず、記録時点のIDだけを返す。
 * OpenAPI response schemaとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const auditLogDto = z
  .object({
    id: z.number().int(),
    organizationId: z.number().int(),
    action: z.enum(auditActionValues).openapi({
      description: 'イベント種別。MEMBER_ROLE_CHANGED（メンバーのロール変更）またはOWNERSHIP_TRANSFERRED（組織の所有権移譲）。',
    }),
    actorUserId: z.number().int().openapi({
      description: 'イベントを実行したユーザーのID。MEMBER_ROLE_CHANGEDでは操作者。OWNERSHIP_TRANSFERREDでは移譲元のOWNER（移譲後はADMINになる）。',
    }),
    targetUserId: z.number().int().openapi({ description: '対象ユーザーのID。OWNERSHIP_TRANSFERREDでは移譲先。' }),
    targetMembershipId: z.number().int().openapi({ description: '対象メンバーシップのID。OWNERSHIP_TRANSFERREDでは移譲先のメンバーシップ。' }),
    previousRole: z.enum(roleValues).openapi({
      description: '対象の変更前ロール。MEMBER_ROLE_CHANGEDでは対象メンバーの変更前、OWNERSHIP_TRANSFERREDでは移譲先の変更前（ADMINまたはMEMBER）。',
    }),
    newRole: z.enum(roleValues).openapi({
      description:
        '対象の変更後ロール。MEMBER_ROLE_CHANGEDでは対象メンバーの変更後、OWNERSHIP_TRANSFERREDでは常にOWNER（移譲元がOWNERからADMINになったことも表す）。',
    }),
    createdAt: z.iso.datetime(),
  })
  .openapi('AuditLog')

/**
 * GET /organizations/{id}/audit-logs の応答DTO（カーソル式ページネーション）。
 * 次ページの有無は `nextCursor !== null` で表す。
 * OpenAPI response schemaとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const auditLogListDto = z.object({ items: z.array(auditLogDto), nextCursor: z.string().nullable() }).openapi('AuditLogList')

export type AuditLogDtoType = z.infer<typeof auditLogDto>
export type AuditLogListDtoType = z.infer<typeof auditLogListDto>
export type MemberListDtoType = z.infer<typeof memberListDto>
export type OrganizationListDtoType = z.infer<typeof organizationListDto>
