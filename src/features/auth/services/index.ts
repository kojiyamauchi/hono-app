import { sign } from 'hono/jwt'

import type { UserResponse } from '@/shared/user/dtos'
import { toUserResponse } from '@/shared/user/mappers'
import { userRepository } from '@/shared/user/repositories'
import { AppError } from '@/utils/errors'

import type { LoginInput, SignupInput } from '../schemas'

/**
 * 認証結果（発行したトークンとユーザー情報）。
 */
type AuthResult = {
  token: string
  user: UserResponse
}

/**
 * 環境変数からJWT署名用のシークレットを取得する。未設定なら500エラー。
 */
const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new AppError(500, 'JWT_SECRETが設定されていません')
  }
  return secret
}

/**
 * 指定ユーザーIDのJWTを発行する（有効期限24時間）。
 */
const issueToken = async (userId: number): Promise<string> => {
  const payload = {
    sub: userId,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
  }
  return sign(payload, getJwtSecret())
}

/**
 * 認証に関するビジネスロジック。
 */
export const authService = {
  /**
   * サインアップ。メール重複を確認し、パスワードをハッシュ化して登録する。
   */
  signup: async (input: SignupInput): Promise<AuthResult> => {
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

    const token = await issueToken(user.id)
    return { token, user: toUserResponse(user) }
  },

  /**
   * ログイン。メールでユーザーを引き、パスワードを検証してトークンを発行する。
   */
  login: async (input: LoginInput): Promise<AuthResult> => {
    const user = await userRepository.findByEmail(input.email)
    if (!user) {
      throw new AppError(401, 'メールアドレスまたはパスワードが正しくありません')
    }

    const isValid = await Bun.password.verify(input.password, user.password)
    if (!isValid) {
      throw new AppError(401, 'メールアドレスまたはパスワードが正しくありません')
    }

    const token = await issueToken(user.id)
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
