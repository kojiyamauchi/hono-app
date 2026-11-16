import type { Context, TypedResponse } from 'hono'

import type { ListDtoType } from '../dtos/auditLogs'
import type { ListQuerySchemaType } from '../schemas/auditLogs'
import { auditLogsService } from '../services/auditLogs'

/**
 * organizations/audit-logs featureのコントローラ。
 */
export const auditLogsController = {
  /**
   * 組織の監査ログを、検証済みqueryのlimit・cursorで1ページ分返す。
   */
  list: async (c: Context, organizationId: number, query: ListQuerySchemaType): Promise<TypedResponse<ListDtoType, 200, 'json'>> => {
    const result = await auditLogsService.list(organizationId, query.limit, query.cursor)
    return c.json(result, 200)
  },
}
