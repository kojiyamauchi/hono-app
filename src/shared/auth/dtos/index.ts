import type { UserResponse } from '@/shared/user/dtos'

/**
 * 認証結果のAPIレスポンス表現。
 */
export type AuthResult = {
  token: string
  user: UserResponse
}

/**
 * 自前認証でリフレッシュトークンを含めて返す認証結果。
 */
export type RefreshableAuthResult = AuthResult & {
  refreshToken: string
}
