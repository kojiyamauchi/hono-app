import type { OrganizationResponse } from '@/shared/organization/dtos'
import type { Organization } from '@/shared/organization/entities'

/**
 * OrganizationエンティティをAPIレスポンス用のOrganizationResponseへ変換する。
 */
export const toOrganizationResponse = (organization: Organization): OrganizationResponse => {
  return {
    id: organization.id,
    name: organization.name,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
  }
}
