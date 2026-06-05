import type { PublicUserResponse, UserResponse } from '@/shared/user/dtos'
import { toPublicUserResponse, toUserResponse } from '@/shared/user/mappers'
import { userRepository } from '@/shared/user/repositories'
import { AppError } from '@/utils/errors'

import type { UpdateMeInput } from '../schemas'

/**
 * users featureのユースケースを提供するサービス。
 */
export const usersService = {
  /**
   * 認証済みユーザー自身の情報を取得する。
   */
  getMe: async (userId: number): Promise<UserResponse> => {
    const user = await userRepository.findById(userId)
    if (!user) {
      throw new AppError(404, 'ユーザーが見つかりません')
    }

    return toUserResponse(user)
  },

  /**
   * 認証済みユーザー自身の情報を更新する。
   */
  updateMe: async (userId: number, input: UpdateMeInput): Promise<UserResponse> => {
    const user = await userRepository.findById(userId)
    if (!user) {
      throw new AppError(404, 'ユーザーが見つかりません')
    }

    const updatedUser = await userRepository.updateById(user.id, input)
    return toUserResponse(updatedUser)
  },

  /**
   * 指定IDのユーザー公開情報を取得する。
   */
  getById: async (id: number): Promise<PublicUserResponse> => {
    const user = await userRepository.findById(id)
    if (!user) {
      throw new AppError(404, 'ユーザーが見つかりません')
    }

    return toPublicUserResponse(user)
  },
}
