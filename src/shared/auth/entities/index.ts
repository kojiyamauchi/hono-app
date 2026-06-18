/**
 * リフレッシュトークンの永続化表現。
 */
export type RefreshToken = {
  id: number
  userId: number
  familyId: string
  tokenHash: string
  expiresAt: Date
  revokedAt: Date | null
  createdAt: Date
}
