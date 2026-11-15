/**
 * メールアドレス検証トークンの永続化表現。
 */
export type EmailVerificationToken = {
  id: number
  userId: number
  tokenHash: string
  expiresAt: Date
  usedAt: Date | null
  createdAt: Date
}
