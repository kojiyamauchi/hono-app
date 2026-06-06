import { Prisma } from '@/generated/prisma/client'

/**
 * Prismaの「対象レコードが見つからない」エラーかどうかを判定する。
 */
export const isPrismaNotFoundError = (error: unknown): error is Prisma.PrismaClientKnownRequestError => {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025'
}
