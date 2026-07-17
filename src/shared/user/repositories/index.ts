import { prisma } from '@/libs/prisma'
import type { User } from '@/shared/user/entities'
import { isPrismaNotFoundError, isPrismaUniqueConstraintError } from '@/utils/prisma'

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
   * IDに対応するユーザーが存在するかを返す。
   */
  existsById: async (id: number): Promise<boolean> => {
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true } })
    return user !== null
  },

  /**
   * ユーザーを新規作成する。メールの一意制約違反（同時signupの競合）の場合はnullを返す。
   * 事前のfindByEmailチェックをすり抜けた競合の最終防衛をDB制約に委ねるため、
   * P2002をnullへ畳み込みinvitation/membershipリポジトリの流儀に揃える。
   */
  create: async (input: CreateUserInput): Promise<User | null> => {
    try {
      return await prisma.user.create({ data: input })
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        return null
      }

      throw error
    }
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
