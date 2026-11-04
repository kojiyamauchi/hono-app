import { z } from '@hono/zod-openapi'

import { memberDto } from '@/shared/membership/dtos'
import { organizationDto } from '@/shared/organization/dtos'

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

export type MemberListDtoType = z.infer<typeof memberListDto>
export type OrganizationListDtoType = z.infer<typeof organizationListDto>
