import { z } from '@hono/zod-openapi'

import { memberDto } from '@/shared/membership/dtos'

/**
 * GET /organizations/{id}/members の応答DTO（カーソル式ページネーション）。
 * 次ページの有無は `nextCursor !== null` で表すため、limitのエコーとhasNextは持たない。
 * OpenAPI response schemaとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const listDto = z.object({ items: z.array(memberDto), nextCursor: z.string().nullable() }).openapi('MemberList')

export type ListDtoType = z.infer<typeof listDto>
