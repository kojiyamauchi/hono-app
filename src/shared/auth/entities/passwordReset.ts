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
