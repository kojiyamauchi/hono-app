/**
 * Userドメインエンティティ。
 * 永続化層（Prisma）の表現とアプリ内のドメイン表現を分離するための型。
 */
export type User = {
  id: number
  name: string
  email: string
  password: string
  createdAt: Date
  updatedAt: Date
}
