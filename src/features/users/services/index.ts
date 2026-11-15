import type { PublicUserDtoType } from '@/shared/user/dtos'
import { toPublicUserResponse } from '@/shared/user/mappers'
import { userRepository } from '@/shared/user/repositories'
import { AppError } from '@/utils/errors'

/**
 * users feature本体（`/users/{id}`）のユースケースを提供するサービス。
 */
export const service = {
  /**
   * 指定IDのユーザー公開情報を取得する。
   */
  getById: async (id: number): Promise<PublicUserDtoType> => {
    const user = await userRepository.findById(id)
    if (!user) {
      throw new AppError(404, 'ユーザーが見つかりません')
    }

    return toPublicUserResponse(user)
  },
}
