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

/**
 * リフレッシュセッション（familyId単位のログインセッション）の集約表現。
 * tokenHash等の内部値は含めず、レスポンス組み立てに必要な値のみ持つ。
 */
export type RefreshSession = {
  familyId: string
  createdAt: Date // family内の最初のcreatedAt（セッション開始日時）
  expiresAt: Date // active行のexpiresAt（現在のセッション継続期限）
  lastUsedAt: Date // active行のcreatedAt（最後にrefresh tokenが発行された時刻）
}
