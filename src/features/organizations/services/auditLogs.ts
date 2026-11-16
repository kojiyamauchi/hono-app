import { AppError } from '@/utils/errors'

import type { ListDtoType } from '../dtos/auditLogs'
import { decodeAuditLogCursor, encodeAuditLogCursor, toAuditLogListResponse } from '../mappers/auditLogs'
import { type AuditLogPageBoundary, auditLogsRepository } from '../repositories/auditLogs'

/**
 * 組織の監査ログ取得のユースケースを提供するサービス。
 */
export const auditLogsService = {
  /**
   * 組織の監査ログを新しい順にカーソル式で1ページ分返す。OWNER/ADMINのみ閲覧可（ミドルウェアで確認済み）。
   * カーソルは境界値としてのみ使い、基準行が削除されても続きが取得できる（行の存在に依存しない）。
   * 次ページの有無は `limit + 1` 件の取得で判定し、レスポンスのitemsは `limit` 件以下にする。
   * 形式が不正なカーソル、別APIで発行されたカーソル（kind不一致）、別組織で発行されたカーソルはいずれも400とする。
   */
  list: async (organizationId: number, limit: number, cursor?: string): Promise<ListDtoType> => {
    let boundary: AuditLogPageBoundary | null = null
    if (cursor !== undefined) {
      const decoded = decodeAuditLogCursor(cursor)
      if (decoded === null || decoded.organizationId !== organizationId) {
        throw new AppError(400, 'カーソルが不正です')
      }
      boundary = { createdAt: decoded.createdAt, id: decoded.id }
    }

    // 認可はカーソル内の組織情報ではなく、引数で渡された認可済みのorganizationIdで毎回適用する
    const auditLogs = await auditLogsRepository.findPage(organizationId, limit + 1, boundary)
    const items = auditLogs.slice(0, limit)
    const last = items.at(-1)
    const nextCursor = auditLogs.length > limit && last !== undefined ? encodeAuditLogCursor({ organizationId, createdAt: last.createdAt, id: last.id }) : null

    return toAuditLogListResponse(items, nextCursor)
  },
}
