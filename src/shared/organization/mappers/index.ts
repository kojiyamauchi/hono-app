import type { OrganizationDtoType } from '@/shared/organization/dtos'
import type { Organization } from '@/shared/organization/entities'

/**
 * OrganizationエンティティをAPIレスポンス用のOrganization DTOへ変換する。
 * 日時はJSONレスポンス形式に合わせてISO datetime文字列へ変換する。
 */
export const toOrganizationResponse = (organization: Organization): OrganizationDtoType => {
  return {
    id: organization.id,
    name: organization.name,
    createdAt: organization.createdAt.toISOString(),
    updatedAt: organization.updatedAt.toISOString(),
  }
}
