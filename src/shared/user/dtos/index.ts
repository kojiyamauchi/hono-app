/**
 * APIレスポンス用のUser表現。
 * 機密情報であるpasswordは含めない。
 */
export type UserResponse = {
  id: number
  name: string
  email: string
  createdAt: Date
  updatedAt: Date
}

/**
 * 公開APIレスポンス用のUser表現。
 * 他ユーザー参照で公開してよい最小限の情報だけを含める。
 */
export type PublicUserResponse = {
  id: number
  name: string
}
