import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/libs/prisma'
import type { PasswordResetToken, RefreshSession, RefreshToken } from '@/shared/auth/entities'

/**
 * リフレッシュトークン作成時の入力値。
 */
export type CreateRefreshTokenInput = {
  userId: number
  familyId: string
  tokenHash: string
  expiresAt: Date
}

/**
 * ローテーション結果。
 */
export type RotateRefreshTokenResult = { status: 'ROTATED'; refreshToken: RefreshToken } | { status: 'REUSED' }

/**
 * リフレッシュトークンのデータアクセスを提供するリポジトリ。
 */
export const refreshTokenRepository = {
  /**
   * リフレッシュトークンを作成する。
   */
  create: async (input: CreateRefreshTokenInput): Promise<RefreshToken> => {
    return prisma.refreshToken.create({ data: input })
  },

  /**
   * ハッシュ値でリフレッシュトークンを取得する。
   */
  findByTokenHash: async (tokenHash: string): Promise<RefreshToken | null> => {
    return prisma.refreshToken.findUnique({ where: { tokenHash } })
  },

  /**
   * 有効なリフレッシュトークンをIDで失効させる。
   */
  revokeById: async (id: number): Promise<boolean> => {
    const result = await prisma.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    return result.count > 0
  },

  /**
   * 同じfamilyに属する有効なリフレッシュトークンを全て失効させる。
   */
  revokeFamily: async (familyId: string): Promise<number> => {
    const result = await prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    return result.count
  },

  /**
   * 指定ユーザーに属する有効なリフレッシュセッションをfamilyIdで失効させる。
   */
  revokeByUserIdAndFamilyId: async (userId: number, familyId: string): Promise<number> => {
    const result = await prisma.refreshToken.updateMany({
      where: { userId, familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    return result.count
  },

  /**
   * 旧トークンの失効と新トークン作成を同一トランザクションで行う。
   * 旧トークンが既に失効している場合はfamilyを失効させ、再利用として返す。
   */
  rotate: async (currentId: number, input: CreateRefreshTokenInput): Promise<RotateRefreshTokenResult> => {
    return prisma.$transaction(async (tx) => {
      const revoked = await tx.refreshToken.updateMany({
        where: { id: currentId, familyId: input.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      })

      if (revoked.count === 0) {
        await tx.refreshToken.updateMany({
          where: { familyId: input.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        })
        return { status: 'REUSED' }
      }

      const refreshToken = await tx.refreshToken.create({ data: input })
      return { status: 'ROTATED', refreshToken }
    })
  },

  /**
   * 指定ユーザーのactiveなリフレッシュセッション一覧を取得する。
   * active行（未失効・未期限切れ）を取得し、対象family群のmin(createdAt)を別クエリで取得して
   * アプリ側で結合する。セッション開始日時(createdAt)はrevoked行を含むfamily内の最初のcreatedAt。
   * active行はfamilyあたり1行である前提（rotation/reuse検出のinvariant）。
   */
  findActiveSessionsByUserId: async (userId: number): Promise<RefreshSession[]> => {
    const now = new Date()
    // active行（未失効・未期限切れ）を取得する
    const activeRows = await prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
      select: { familyId: true, expiresAt: true, createdAt: true },
    })

    if (activeRows.length === 0) {
      return []
    }

    const familyIds = activeRows.map((row) => row.familyId)
    // 対象family群の最初のcreatedAt（revoked行を含む）をgroupByで取得する。
    // familyIdはschema上uniqueではないため、集約側もuserIdで絞り、
    // 別ユーザーのcreatedAtが_min.createdAtへ混ざらないようユーザー境界を明確にする。
    const grouped = await prisma.refreshToken.groupBy({
      by: ['familyId'],
      where: { userId, familyId: { in: familyIds } },
      _min: { createdAt: true },
    })
    const minCreatedAtByFamily = new Map(grouped.map((group) => [group.familyId, group._min.createdAt]))

    return activeRows.map((row) => ({
      familyId: row.familyId,
      // family内の最初のcreatedAt。万一取得できない場合はactive行のcreatedAtへフォールバックする
      createdAt: minCreatedAtByFamily.get(row.familyId) ?? row.createdAt,
      expiresAt: row.expiresAt,
      lastUsedAt: row.createdAt,
    }))
  },

  /**
   * 指定ユーザーの全未失効リフレッシュトークンを失効させる。
   */
  revokeAllByUserId: async (userId: number, client: Prisma.TransactionClient = prisma): Promise<number> => {
    const result = await client.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    return result.count
  },
}

/**
 * 認証資格情報のデータアクセスを提供するリポジトリ。
 */
export const authCredentialRepository = {
  /**
   * パスワード更新と全リフレッシュトークン失効を同一トランザクションで行う。
   * 対象ユーザーが存在しない場合は false を返す。
   */
  changePassword: async (userId: number, hashedPassword: string): Promise<boolean> => {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: { id: userId },
        data: { password: hashedPassword },
      })

      if (updated.count === 0) {
        return false
      }

      await refreshTokenRepository.revokeAllByUserId(userId, tx)

      return true
    })
  },
}

/**
 * パスワードリセットトークンのデータアクセスを提供するリポジトリ。
 */
export const passwordResetTokenRepository = {
  /**
   * パスワードリセットトークンを作成する。
   * 同一ユーザーの未使用・未失効の旧トークンを同一トランザクション内で無効化してから作成する。
   */
  create: async (userId: number, tokenHash: string, expiresAt: Date): Promise<PasswordResetToken> => {
    // userId は @unique。upsert は PostgreSQL では INSERT ... ON CONFLICT DO UPDATE に
    // コンパイルされ原子的なため、同一ユーザーへの並行requestでも常に1行に保たれる
    // （未認証requestの繰り返しによるレコード無制限増加を防ぐ）。
    return prisma.passwordResetToken.upsert({
      where: { userId },
      create: { userId, tokenHash, expiresAt },
      update: { tokenHash, expiresAt, usedAt: null },
    })
  },

  /**
   * ハッシュ値でパスワードリセットトークンを取得する。
   */
  findByTokenHash: async (tokenHash: string): Promise<PasswordResetToken | null> => {
    return prisma.passwordResetToken.findUnique({ where: { tokenHash } })
  },

  /**
   * IDでパスワードリセットトークンを無効化（削除）する。通知失敗時の補償処理に使用する。
   */
  deleteByIdAndTokenHash: async (id: number, tokenHash: string): Promise<number> => {
    // id だけでなく tokenHash の一致も条件にする。createがuserId基準のupsertで行IDを
    // 再利用するため、別requestが同じ行を新しいtokenHashへ更新済みの場合は削除件数0となり、
    // 後発の有効なトークンを誤って削除しない（通知失敗時の補償の安全化）。
    const result = await prisma.passwordResetToken.deleteMany({
      where: { id, tokenHash },
    })
    return result.count
  },

  /**
   * トークン消費・パスワード更新・全リフレッシュトークン失効を原子的に行う。
   * 並行実行時に1件だけ成功するよう条件付き updateMany でトークンを消費する。
   * 戻り値が false の場合はトークンが既に消費済みまたは並行競合を示す。
   */
  confirm: async (tokenId: number, userId: number, hashedPassword: string): Promise<boolean> => {
    return prisma.$transaction(async (tx) => {
      // 条件付き更新でトークンを消費する。未使用かつ有効期限内のみ消費し、
      // 期限切れ・使用済み・並行競合をすべて count===0（false）へ畳み込む。
      // serviceの事前チェックとtransaction開始の間に期限を跨いでも、ここで原子的に弾く。
      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: tokenId, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      })

      if (consumed.count === 0) {
        return false
      }

      // パスワードを更新する
      await tx.user.update({
        where: { id: userId },
        data: { password: hashedPassword },
      })

      // 同一トランザクション内で全リフレッシュトークンを失効させる（同じtxへ参加させる）
      await refreshTokenRepository.revokeAllByUserId(userId, tx)

      return true
    })
  },
}
