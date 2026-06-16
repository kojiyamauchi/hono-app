import { sign } from 'hono/jwt'

import { AppError } from '@/utils/errors'

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
export const issueAuthToken = async (userId: number): Promise<string> => {
  const payload = {
    sub: userId,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
  }
  return sign(payload, getJwtSecret())
}
