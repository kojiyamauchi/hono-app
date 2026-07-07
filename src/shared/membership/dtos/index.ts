import { z } from 'zod'

import { roleValues } from '@/shared/membership/entities'

/**
 * APIレスポンス用のMembership DTO。
 * `role` の列挙値はentity側の `roleValues` を正本とする。
 * `createdAt` はJSONレスポンス上のISO datetime文字列として扱う。
 */
export const memberDto = z.object({
  id: z.number().int(),
  userId: z.number().int(),
  organizationId: z.number().int(),
  role: z.enum(roleValues),
  createdAt: z.iso.datetime(),
})

export type MemberDtoType = z.infer<typeof memberDto>
