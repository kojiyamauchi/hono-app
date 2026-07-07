import { z } from 'zod'

/**
 * APIレスポンス用のMembership DTO。
 * `createdAt` はJSONレスポンス上のISO datetime文字列として扱う。
 */
export const memberDto = z.object({
  id: z.number().int(),
  userId: z.number().int(),
  organizationId: z.number().int(),
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER']),
  createdAt: z.iso.datetime(),
})

export type MemberDtoType = z.infer<typeof memberDto>
