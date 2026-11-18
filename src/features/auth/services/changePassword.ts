import { authCredentialRepository } from '@/shared/auth/repositories/credential'
import { userRepository } from '@/shared/user/repositories'
import { AppError } from '@/utils/errors'
import { hashPassword, verifyPassword } from '@/utils/runtime'

/**
 * パスワード変更のビジネスロジック。
 */
export const changePasswordService = {
  /**
   * ログイン済みユーザーのパスワードを変更する。
   * 成功時は全リフレッシュトークンを失効し、再ログインを要求する。
   */
  execute: async (userId: number, currentPassword: string, newPassword: string): Promise<void> => {
    const user = await userRepository.findById(userId)
    if (!user) {
      throw new AppError(404, 'ユーザーが見つかりません')
    }

    const isCurrentPasswordValid = await verifyPassword(currentPassword, user.password)
    if (!isCurrentPasswordValid) {
      throw new AppError(401, '現在のパスワードが正しくありません')
    }

    if (currentPassword === newPassword) {
      throw new AppError(400, '新しいパスワードは現在のパスワードと異なる値を入力してください')
    }

    const hashedPassword = await hashPassword(newPassword)
    const changed = await authCredentialRepository.changePassword(userId, hashedPassword)

    if (!changed) {
      throw new AppError(404, 'ユーザーが見つかりません')
    }
  },
}
