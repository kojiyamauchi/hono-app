import type { UserDtoType } from '@/shared/user/dtos'
import { toUserResponse } from '@/shared/user/mappers'
import { userRepository } from '@/shared/user/repositories'
import { AppError } from '@/utils/errors'
import { verifyPassword } from '@/utils/runtime'

import { accountDeletionResults, meRepository } from '../repositories/me'
import type { UpdateBodySchemaType } from '../schemas/me'

/**
 * users feature の `/users/me` に関するユースケースを提供するサービス。
 */
export const meService = {
  /**
   * 認証済みユーザー自身の情報を取得する。
   */
  get: async (userId: number): Promise<UserDtoType> => {
    const user = await userRepository.findById(userId)
    if (!user) {
      throw new AppError(404, 'ユーザーが見つかりません')
    }

    return toUserResponse(user)
  },

  /**
   * 認証済みユーザー自身の情報を更新する。
   */
  update: async (userId: number, input: UpdateBodySchemaType): Promise<UserDtoType> => {
    const user = await userRepository.findById(userId)
    if (!user) {
      throw new AppError(404, 'ユーザーが見つかりません')
    }

    const updatedUser = await userRepository.updateById(user.id, input)
    if (!updatedUser) {
      throw new AppError(404, 'ユーザーが見つかりません')
    }

    return toUserResponse(updatedUser)
  },

  /**
   * 現在のパスワードで本人確認し、認証済みユーザー自身のアカウントを削除する。
   */
  remove: async (userId: number, currentPassword: string): Promise<void> => {
    const result = await meRepository.remove(userId, (passwordHash) => verifyPassword(currentPassword, passwordHash))

    // 成功（DELETED）だけを先頭で通し、未知の結果値はエラー側へ倒す（fail-closed）
    if (result === accountDeletionResults.deleted) {
      return
    }
    if (result === accountDeletionResults.notFound) {
      throw new AppError(404, 'ユーザーが見つかりません')
    }
    if (result === accountDeletionResults.invalidPassword) {
      throw new AppError(401, '現在のパスワードが正しくありません')
    }
    throw new AppError(409, '唯一のOWNERである組織が存在するためアカウントを削除できません')
  },
}
