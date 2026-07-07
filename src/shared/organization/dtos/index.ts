import { z } from 'zod'

/**
 * APIレスポンス用のOrganization DTO。
 * `createdAt` / `updatedAt` はJSONレスポンス上のISO datetime文字列として扱う。
 */
export const organizationDto = z.object({
  id: z.number().int(),
  name: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export type OrganizationDtoType = z.infer<typeof organizationDto>
