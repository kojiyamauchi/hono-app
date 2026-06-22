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

/**
 * パスワードリセットトークンの永続化表現。
 */
export type PasswordResetToken = {
  id: number
  userId: number
  tokenHash: string
  expiresAt: Date
  usedAt: Date | null
  createdAt: Date
}
