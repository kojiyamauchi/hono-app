import type { UserResponse } from '@/shared/user/dtos'
import type { User } from '@/shared/user/entities'

/**
 * UserエンティティをAPIレスポンス用のUserResponseへ変換する。
 * passwordを除外することで、機密情報の漏洩を防ぐ。
 */
export const toUserResponse = (user: User): UserResponse => {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
}
