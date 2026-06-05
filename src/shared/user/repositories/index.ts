import { prisma } from '@/libs/prisma'
import type { User } from '@/shared/user/entities'
import { isPrismaNotFoundError } from '@/utils/prisma'

/**
 * Userの新規作成時に必要な入力値。
 */
type CreateUserInput = {
  name: string
  email: string
  password: string
}

/**
 * Userの更新時に変更可能な入力値。
 */
type UpdateUserInput = {
  name: string
}

/**
 * Userのデータアクセスを提供するリポジトリ。
 * Prismaへの依存をこの層に閉じ込める。
 */
export const userRepository = {
  /**
   * メールアドレスでユーザーを1件検索する。存在しない場合はnullを返す。
   */
  findByEmail: async (email: string): Promise<User | null> => {
    return prisma.user.findUnique({ where: { email } })
  },

  /**
   * IDでユーザーを1件検索する。存在しない場合はnullを返す。
   */
  findById: async (id: number): Promise<User | null> => {
    return prisma.user.findUnique({ where: { id } })
  },

  /**
   * ユーザーを新規作成する。
   */
  create: async (input: CreateUserInput): Promise<User> => {
    return prisma.user.create({ data: input })
  },

  /**
   * IDで指定したユーザーを更新する。存在しない場合はnullを返す。
   */
  updateById: async (id: number, input: UpdateUserInput): Promise<User | null> => {
    try {
      return await prisma.user.update({
        where: { id },
        data: input,
      })
    } catch (error) {
      if (isPrismaNotFoundError(error)) {
        return null
      }

      throw error
    }
  },
}
