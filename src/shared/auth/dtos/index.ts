import type { UserResponse } from '@/shared/user/dtos'

/**
 * 認証結果の公開HTTPレスポンス表現。アクセストークンとユーザー情報のみ含む。
 */
export type AuthResult = {
  token: string
  user: UserResponse
}

/**
 * 自前認証における内部発行結果。アクセストークン・リフレッシュトークン・ユーザー情報を含む。
 * controllerでリフレッシュトークンをCookieへ設定し、bodyにはAuthResultのみ返す。
 */
export type IssuedAuthTokens = AuthResult & {
  refreshToken: string
}

/**
 * リフレッシュセッションの公開HTTPレスポンス表現。
 * tokenHashなどの内部値は含めない。idはfamilyId（rotationで変わらない安定した識別子）。
 */
export type SessionResponse = {
  id: string
  createdAt: Date
  expiresAt: Date
  lastUsedAt: Date
}
