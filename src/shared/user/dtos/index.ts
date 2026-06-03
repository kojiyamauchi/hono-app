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
