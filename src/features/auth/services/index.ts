import type { AuthResult } from '@/shared/auth/dtos'
import { issueAuthToken } from '@/shared/auth/services'
import type { UserResponse } from '@/shared/user/dtos'
import { toUserResponse } from '@/shared/user/mappers'
import { userRepository } from '@/shared/user/repositories'
import { AppError } from '@/utils/errors'

import type { LoginSchemaType, SignupSchemaType } from '../schemas'

/**
 * 認証に関するビジネスロジック。
 */
export const authService = {
  /**
   * サインアップ。メール重複を確認し、パスワードをハッシュ化して登録する。
   */
  signup: async (input: SignupSchemaType): Promise<AuthResult> => {
    const existing = await userRepository.findByEmail(input.email)
    if (existing) {
      throw new AppError(409, 'このメールアドレスは既に登録されています')
    }

    const hashedPassword = await Bun.password.hash(input.password)
    const user = await userRepository.create({
      name: input.name,
      email: input.email,
      password: hashedPassword,
    })

    const token = await issueAuthToken(user.id)
    return { token, user: toUserResponse(user) }
  },

  /**
   * ログイン。メールでユーザーを引き、パスワードを検証してトークンを発行する。
   */
  login: async (input: LoginSchemaType): Promise<AuthResult> => {
    const user = await userRepository.findByEmail(input.email)
    if (!user) {
      throw new AppError(401, 'メールアドレスまたはパスワードが正しくありません')
    }

    const isValid = await Bun.password.verify(input.password, user.password)
    if (!isValid) {
      throw new AppError(401, 'メールアドレスまたはパスワードが正しくありません')
    }

    const token = await issueAuthToken(user.id)
    return { token, user: toUserResponse(user) }
  },

  /**
   * IDでユーザー情報を取得する（/auth/me 用）。
   */
  getById: async (id: number): Promise<UserResponse> => {
    const user = await userRepository.findById(id)
    if (!user) {
      throw new AppError(404, 'ユーザーが見つかりません')
    }
    return toUserResponse(user)
  },
}
