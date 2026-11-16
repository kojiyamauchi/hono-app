import type { UserDtoType } from '@/shared/user/dtos'
import { toUserResponse } from '@/shared/user/mappers'
import { userRepository } from '@/shared/user/repositories'
import { AppError } from '@/utils/errors'

/**
 * 認証済みユーザー自身に関するビジネスロジック。
 */
export const meService = {
  /**
   * IDでユーザー情報を取得する（/auth/me 用）。
   */
  get: async (id: number): Promise<UserDtoType> => {
    const user = await userRepository.findById(id)
    if (!user) {
      throw new AppError(404, 'ユーザーが見つかりません')
    }
    return toUserResponse(user)
  },
}
