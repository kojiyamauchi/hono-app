import { z } from '@hono/zod-openapi'

/**
 * APIレスポンス用のOrganization DTO。
 * `createdAt` / `updatedAt` はJSONレスポンス上のISO datetime文字列として扱う。
 * OpenAPI response schemaとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const organizationDto = z
  .object({
    id: z.number().int(),
    name: z.string(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .openapi('Organization')

export type OrganizationDtoType = z.infer<typeof organizationDto>
