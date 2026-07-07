import { z } from 'zod'

/**
 * APIレスポンス用のUser DTO。
 * 機密情報であるpasswordは含めない。
 * `createdAt` / `updatedAt` はJSONレスポンス上のISO datetime文字列として扱う。
 */
export const userDto = z.object({
  id: z.number().int(),
  name: z.string(),
  email: z.email(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export type UserDtoType = z.infer<typeof userDto>

/**
 * 公開APIレスポンス用のUser DTO。
 * 他ユーザー参照で公開してよい最小限の情報だけを含める。
 */
export const publicUserDto = z.object({
  id: z.number().int(),
  name: z.string(),
})

export type PublicUserDtoType = z.infer<typeof publicUserDto>
