import { z } from '@hono/zod-openapi'

import { invitationStatusValues } from '@/shared/invitation/entities'
import { roleValues } from '@/shared/membership/entities'

/**
 * APIレスポンス用のInvitation DTO。
 * `role` / `status` の列挙値はそれぞれentity側の `roleValues` / `invitationStatusValues` を正本とする。
 * DBカラム名 `token` はレスポンスでは `invitationToken` として公開する。
 * `expiresAt` / `createdAt` はJSONレスポンス上のISO datetime文字列として扱う。
 * OpenAPI response schemaとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const invitationDto = z
  .object({
    id: z.number().int(),
    organizationId: z.number().int(),
    email: z.email(),
    role: z.enum(roleValues),
    status: z.enum(invitationStatusValues),
    invitationToken: z.string(),
    expiresAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
  })
  .openapi('Invitation')

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
  status: z.enum(invitationStatusValues),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
})

export type InvitationDetailDtoType = z.infer<typeof invitationDetailDto>
