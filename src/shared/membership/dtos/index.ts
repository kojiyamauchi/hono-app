import { z } from '@hono/zod-openapi'

import { roleValues } from '@/shared/membership/entities'

/**
 * APIレスポンス用のMembership DTO。
 * `role` の列挙値はentity側の `roleValues` を正本とする。
 * `createdAt` はJSONレスポンス上のISO datetime文字列として扱う。
 * OpenAPI response schemaとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const memberDto = z
  .object({
    id: z.number().int(),
    userId: z.number().int(),
    organizationId: z.number().int(),
    role: z.enum(roleValues),
    createdAt: z.iso.datetime(),
  })
  .openapi('Member')

export type MemberDtoType = z.infer<typeof memberDto>
