import { z } from 'zod'

import { userDto } from '@/shared/user/dtos'

/**
 * 認証結果の公開HTTPレスポンス用DTO。アクセストークンとユーザー情報のみ含む。
 */
export const authResultDto = z.object({
  token: z.string(),
  user: userDto,
})

export type AuthResultDtoType = z.infer<typeof authResultDto>

/**
 * 自前認証における内部発行結果。アクセストークン・リフレッシュトークン・ユーザー情報を含む。
 * refreshTokenはレスポンスbodyには含めず、controllerでCookieへ設定する内部専用の値のため、
 * OpenAPI response schemaにはせず、DTO型（AuthResultDtoType）を拡張した内部型として定義する。
 */
export type IssuedAuthTokens = AuthResultDtoType & {
  refreshToken: string
}

/**
 * リフレッシュセッションの公開HTTPレスポンス用DTO。
 * tokenHashなどの内部値は含めない。idはfamilyId（rotationで変わらない安定した識別子）。
 * 日時はJSONレスポンス上のISO datetime文字列として扱う。
 */
export const sessionDto = z.object({
  id: z.string(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
})

export type SessionDtoType = z.infer<typeof sessionDto>
