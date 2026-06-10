import { Prisma } from '@/generated/prisma/client'

/**
 * Prismaの「対象レコードが見つからない」エラーかどうかを判定する。
 */
export const isPrismaNotFoundError = (error: unknown): error is Prisma.PrismaClientKnownRequestError => {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025'
}

/**
 * Prismaの「一意制約違反」エラーかどうかを判定する。
 */
export const isPrismaUniqueConstraintError = (error: unknown): error is Prisma.PrismaClientKnownRequestError => {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}
