import type { Organization } from '@/shared/organization/entities'
import { toOrganizationResponse } from '@/shared/organization/mappers'

import type { ListDtoType } from '../dtos'

/**
 * 組織のページをオフセット式ページネーションの応答DTOへ変換する。
 */
export const toListResponse = (organizations: Organization[], limit: number, offset: number, hasNext: boolean): ListDtoType => {
  return {
    items: organizations.map(toOrganizationResponse),
    limit,
    offset,
    hasNext,
  }
}
