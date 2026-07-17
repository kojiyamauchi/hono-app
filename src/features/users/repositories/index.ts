import { prisma } from '@/libs/prisma'

/** アカウント削除repositoryの処理結果。 */
export const accountDeletionResults = {
  deleted: 'DELETED',
  notFound: 'NOT_FOUND',
  invalidPassword: 'INVALID_PASSWORD',
  soleOwner: 'SOLE_OWNER',
} as const

export type AccountDeletionResult = (typeof accountDeletionResults)[keyof typeof accountDeletionResults]

type LockedUserRow = {
  id: number
  email: string
  password: string
}

type LockedIdRow = {
  id: number
}

/** ロック中のユーザーのパスワードハッシュを検証する関数。 */
type VerifyPassword = (passwordHash: string) => Promise<boolean>

/**
 * users feature固有のアカウント削除データアクセスを提供するリポジトリ。
 */
export const accountDeletionRepository = {
  /**
   * User行を最初にロックし、本人確認・OWNER判定・関連データ失効・User削除を原子的に行う。
   */
  deleteAccount: async (userId: number, verifyPassword: VerifyPassword): Promise<AccountDeletionResult> => {
    return prisma.$transaction(async (tx) => {
      // OWNERを成立・消滅させ得る処理の共通規約として、対象User行を最初にロックする。
      const lockedUsers = await tx.$queryRaw<LockedUserRow[]>`
        SELECT id, email, password
        FROM "User"
        WHERE id = ${userId}
        FOR UPDATE
      `
      const user = lockedUsers[0]
      if (!user) {
        return accountDeletionResults.notFound
      }

      if (!(await verifyPassword(user.password))) {
        return accountDeletionResults.invalidPassword
      }

      // 対象ユーザー以外のOWNERがいない組織を1件でも所有している場合は削除を拒否する。
      const soleOwnerMemberships = await tx.$queryRaw<LockedIdRow[]>`
        SELECT owned.id
        FROM "Membership" AS owned
        WHERE
          owned."userId" = ${userId}
          AND owned.role = 'OWNER'
          AND NOT EXISTS (
            SELECT 1
            FROM "Membership" AS another_owner
            WHERE
              another_owner."organizationId" = owned."organizationId"
              AND another_owner.role = 'OWNER'
              AND another_owner."userId" <> ${userId}
          )
        LIMIT 1
      `
      if (soleOwnerMemberships.length > 0) {
        return accountDeletionResults.soleOwner
      }

      // 同じメールアドレスで再登録したユーザーが過去の招待を受諾できないよう、削除前に失効させる。
      await tx.invitation.updateMany({
        where: { email: user.email, status: 'PENDING' },
        data: { status: 'CANCELED' },
      })
      await tx.user.delete({ where: { id: userId } })

      return accountDeletionResults.deleted
    })
  },
}
