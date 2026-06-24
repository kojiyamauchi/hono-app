import type { SessionResponse } from '@/shared/auth/dtos'
import type { RefreshSession } from '@/shared/auth/entities'

/**
 * RefreshSessionをAPIレスポンス用のSessionResponseへ変換する。
 * familyIdを安定した識別子idとして公開し、tokenHash等の内部値は含めない。
 */
export const toSessionResponse = (session: RefreshSession): SessionResponse => {
  return {
    id: session.familyId,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    lastUsedAt: session.lastUsedAt,
  }
}
