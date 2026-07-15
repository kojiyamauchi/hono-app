import type { PublicUserDtoType, UserDtoType } from '@/shared/user/dtos'
import type { User } from '@/shared/user/entities'

/**
 * UserエンティティをAPIレスポンス用のUser DTOへ変換する。
 * passwordを除外することで、機密情報の漏洩を防ぐ。
 * 日時はJSONレスポンス形式に合わせてISO datetime文字列へ変換する。
 */
export const toUserResponse = (user: User): UserDtoType => {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  }
}

/**
 * Userエンティティを公開APIレスポンス用のPublic User DTOへ変換する。
 * emailや作成日時など、本人以外へ不要な情報は含めない。
 */
export const toPublicUserResponse = (user: User): PublicUserDtoType => {
  return {
    id: user.id,
    name: user.name,
  }
}
