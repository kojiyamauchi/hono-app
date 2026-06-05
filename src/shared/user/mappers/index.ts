import type { PublicUserResponse, UserResponse } from '@/shared/user/dtos'
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

/**
 * Userエンティティを公開APIレスポンス用のPublicUserResponseへ変換する。
 * emailや作成日時など、本人以外へ不要な情報は含めない。
 */
export const toPublicUserResponse = (user: User): PublicUserResponse => {
  return {
    id: user.id,
    name: user.name,
  }
}
