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
    action: z.enum(auditActionValues),
    actorUserId: z.number().int(),
    targetUserId: z.number().int(),
    targetMembershipId: z.number().int(),
    previousRole: z.enum(roleValues),
    newRole: z.enum(roleValues),
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
