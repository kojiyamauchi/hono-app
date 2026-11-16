import { z } from '@hono/zod-openapi'

import { organizationDto } from '@/shared/organization/dtos'

/**
 * GET /organizations の応答DTO（オフセット式ページネーション）。
 * 数値による位置（limit・offset）と後続の有無（hasNext）を返す。
 * OpenAPI response schemaとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const listDto = z
  .object({ items: z.array(organizationDto), limit: z.number().int(), offset: z.number().int(), hasNext: z.boolean() })
  .openapi('OrganizationList')

export type ListDtoType = z.infer<typeof listDto>
