import type { UserResponse } from '@/shared/user/dtos'

/**
 * 認証結果のAPIレスポンス表現。
 */
export type AuthResult = {
  token: string
  user: UserResponse
}
