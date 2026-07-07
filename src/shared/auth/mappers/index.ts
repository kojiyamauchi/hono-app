import type { SessionDtoType } from '@/shared/auth/dtos'
import type { RefreshSession } from '@/shared/auth/entities'

/**
 * RefreshSessionをAPIレスポンス用のSession DTOへ変換する。
 * familyIdを安定した識別子idとして公開し、tokenHash等の内部値は含めない。
 * 日時はJSONレスポンス形式に合わせてISO datetime文字列へ変換する。
 */
export const toSessionResponse = (session: RefreshSession): SessionDtoType => {
  return {
    id: session.familyId,
    createdAt: session.createdAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    lastUsedAt: session.lastUsedAt.toISOString(),
  }
}
