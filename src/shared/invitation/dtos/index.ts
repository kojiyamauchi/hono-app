import { z } from 'zod'

import { roleValues } from '@/shared/membership/entities'

/**
 * APIレスポンス用のInvitation DTO。
 * DBカラム名 `token` はレスポンスでは `invitationToken` として公開する。
 * `expiresAt` / `createdAt` はJSONレスポンス上のISO datetime文字列として扱う。
 */
export const invitationDto = z.object({
  id: z.number().int(),
  organizationId: z.number().int(),
  email: z.email(),
  role: z.enum(roleValues),
  status: z.enum(['PENDING', 'ACCEPTED', 'EXPIRED', 'CANCELED', 'DECLINED']),
  invitationToken: z.string(),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
})

export type InvitationDtoType = z.infer<typeof invitationDto>

/**
 * 招待詳細取得エンドポイント用の公開レスポンスDTO。
 * トークンは含めず、organization情報（id・name）をネストして含む。
 */
export const invitationDetailDto = z.object({
  id: z.number().int(),
  organization: z.object({
    id: z.number().int(),
    name: z.string(),
  }),
  email: z.email(),
  role: z.enum(roleValues),
  status: z.enum(['PENDING', 'ACCEPTED', 'EXPIRED', 'CANCELED', 'DECLINED']),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
})

export type InvitationDetailDtoType = z.infer<typeof invitationDetailDto>
