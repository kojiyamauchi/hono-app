import type { InvitationEmailDeliveryStatus, InvitationStatus } from '@/generated/prisma/client'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/libs/prisma'
import { calculateInvitationEmailDeadline, type InvitationEmailSnapshot } from '@/shared/invitation/entities/emailDelivery'
import type { Role } from '@/shared/membership/entities'

/** 招待メール手動再送repositoryの処理結果の種別。 */
export const invitationEmailResendResults = {
  requested: 'REQUESTED',
  organizationNotFound: 'ORGANIZATION_NOT_FOUND',
  rejected: 'REJECTED',
} as const

/**
 * 招待メール手動再送repositoryの処理結果。
 * `rejected` は判定コールバックが返した拒否値をそのまま運ぶ（repositoryはHTTPエラーを知らない）。
 */
export type InvitationEmailResendResult<TRejection> =
  | { status: typeof invitationEmailResendResults.requested }
  | { status: typeof invitationEmailResendResults.organizationNotFound }
  | { status: typeof invitationEmailResendResults.rejected; rejection: TRejection }

/** 手動再送の入力。 */
export type RequestInvitationEmailResendInput = {
  organizationId: number
  invitationId: number
  /** 操作者（認証済みユーザー）のユーザーID。ロールはロック後のMembershipから読み直す。 */
  actorUserId: number
  /** 再送時点で固定する送信設定。配信設定が無効・不備の場合は `null`（判定コールバックが拒否する前提）。 */
  snapshot: InvitationEmailSnapshot | null
}

/** ロック後に確定した招待の状態。 */
export type LockedResendInvitation = {
  role: Role
  status: InvitationStatus
  expiresAt: Date
}

/** ロック後に確定した配信行の状態。 */
export type LockedResendDelivery = {
  status: InvitationEmailDeliveryStatus
  hasUnknownOutcome: boolean
  lastError: string | null
  manualResendRequestedAt: Date | null
}

/** 操作者の認可で受け取る、Membershipをロックした後のロール。 */
export type LockedResendOperatorState = {
  operatorRole: Role
}

/** 対象の認可で受け取る、招待をロックした後の状態。組織内に存在しない（または別組織の）招待は `null`。 */
export type LockedResendTargetState = {
  operatorRole: Role
  invitation: LockedResendInvitation | null
}

/**
 * 再送可否の判定で受け取る、すべてのロックを確保した後の状態。
 * `now` は配信行のロック後に取得した判定時刻で、期限判定と再送受付時刻に使う。
 * 配信行がない招待の `delivery` は `null`。
 */
export type LockedResendEvaluationState = {
  invitation: LockedResendInvitation
  delivery: LockedResendDelivery | null
  now: Date
}

/**
 * 段階ごとの同期判定コールバック。許可なら `null`、拒否なら拒否値を返す。
 * ロック中に待たせないため、DBアクセスや非同期処理は行わない。
 * 拒否が確定した段階でtransactionを終え、以降のロックを取得しない。
 */
export type InvitationEmailResendCallbacks<TRejection> = {
  /** 操作者のMembershipをロックした直後に、操作者のロールだけで判定する。 */
  authorizeOperator: (state: LockedResendOperatorState) => TRejection | null
  /** 組織内の招待をロックした直後に、招待の有無と操作者から対象ロールへの権限を判定する。 */
  authorizeTarget: (state: LockedResendTargetState) => TRejection | null
  /** 配信行をロックし判定時刻を取得した後に、受付済み・配信設定・招待状態・期限・再送対象を判定する。 */
  evaluate: (state: LockedResendEvaluationState) => TRejection | null
}

type LockedOrganizationRow = { id: number; name: string }
type LockedMembershipRow = { role: Role }
type LockedInvitationRow = { id: number; role: Role; status: InvitationStatus; expiresAt: Date }
type LockedDeliveryRow = {
  status: InvitationEmailDeliveryStatus
  hasUnknownOutcome: boolean
  lastError: string | null
  manualResendRequestedAt: Date | null
}

/** 招待メールの手動再送に必要なデータアクセスを提供するリポジトリ。 */
export const invitationEmailResendRepository = {
  /**
   * 組織(`FOR KEY SHARE`) → 操作者のMembership(`FOR SHARE`) → 組織内のInvitation(`FOR NO KEY UPDATE`)
   * → 配信行(`FOR UPDATE`)の順にロックし、ロック後の最新の状態を段階ごとのコールバックで判定する。
   * 操作者・対象の認可で拒否された依頼は、後続の行をロックせずに終える（ロック待ちを起こさない）。
   * 許可された場合だけ、既存の配信行を新しい配信IDの配信待ちへ置き換え、再送受付時刻を同じtransactionで確定する。
   * 判定時刻は配信行のロック後に取得する。招待のステータスは更新しない（期限切れでもEXPIREDにしない）。
   *
   * 分離レベルはREAD COMMITTEDを明示する。各SQLが実行時点の最新のコミット済みスナップショットを読むため、
   * 先行する再送が配信行を削除・挿入で置き換えた場合も、後続は置き換え後の行を読んで受付済みを判定できる。
   */
  requestResend: async <TRejection>(
    input: RequestInvitationEmailResendInput,
    callbacks: InvitationEmailResendCallbacks<TRejection>,
  ): Promise<InvitationEmailResendResult<TRejection>> => {
    const { organizationId, invitationId, actorUserId, snapshot } = input

    return prisma.$transaction(
      async (tx): Promise<InvitationEmailResendResult<TRejection>> => {
        const [organization] = await tx.$queryRaw<LockedOrganizationRow[]>`
          SELECT id, name
          FROM "Organization"
          WHERE id = ${organizationId}
          FOR KEY SHARE
        `
        if (!organization) {
          return { status: invitationEmailResendResults.organizationNotFound }
        }

        const [membership] = await tx.$queryRaw<LockedMembershipRow[]>`
          SELECT role::text AS role
          FROM "Membership"
          WHERE "organizationId" = ${organizationId} AND "userId" = ${actorUserId}
          FOR SHARE
        `
        if (!membership) {
          return { status: invitationEmailResendResults.organizationNotFound }
        }
        const operatorRejection = callbacks.authorizeOperator({ operatorRole: membership.role })
        if (operatorRejection !== null) {
          return { status: invitationEmailResendResults.rejected, rejection: operatorRejection }
        }

        const [invitation] = await tx.$queryRaw<LockedInvitationRow[]>`
          SELECT id, role::text AS role, status::text AS status, "expiresAt"
          FROM "Invitation"
          WHERE id = ${invitationId} AND "organizationId" = ${organizationId}
          FOR NO KEY UPDATE
        `
        const targetRejection = callbacks.authorizeTarget({
          operatorRole: membership.role,
          invitation: invitation ? { role: invitation.role, status: invitation.status, expiresAt: invitation.expiresAt } : null,
        })
        if (targetRejection !== null) {
          return { status: invitationEmailResendResults.rejected, rejection: targetRejection }
        }
        if (!invitation) {
          throw new Error('招待メールの再送を許可した状態に招待がありません')
        }

        // 配信行はInvitation行の確保後に別のSQLで読み、置き換え後の行を読めるようにする。
        const [delivery] = await tx.$queryRaw<LockedDeliveryRow[]>`
          SELECT status::text AS status, "hasUnknownOutcome", "lastError", "manualResendRequestedAt"
          FROM "InvitationEmailDelivery"
          WHERE "invitationId" = ${invitation.id}
          FOR UPDATE
        `

        // 判定時刻は、すべてのロック待ちが終わった後に取得する。
        const now = new Date()
        const rejection = callbacks.evaluate({
          invitation: { role: invitation.role, status: invitation.status, expiresAt: invitation.expiresAt },
          delivery: delivery ?? null,
          now,
        })
        if (rejection !== null) {
          return { status: invitationEmailResendResults.rejected, rejection }
        }
        if (!delivery || !snapshot) {
          throw new Error('招待メールの再送を許可した状態に必要な情報が不足しています')
        }

        await tx.invitationEmailDelivery.deleteMany({ where: { invitationId: invitation.id } })
        await tx.invitationEmailDelivery.create({
          data: {
            id: crypto.randomUUID(),
            invitationId: invitation.id,
            fromEmail: snapshot.fromEmail,
            scalarUrl: snapshot.scalarUrl,
            templateVersion: snapshot.templateVersion,
            organizationName: organization.name,
            status: 'PENDING',
            attemptCount: 0,
            nextAttemptAt: now,
            deadline: calculateInvitationEmailDeadline(now, invitation.expiresAt),
            manualResendRequestedAt: now,
          },
        })
        return { status: invitationEmailResendResults.requested }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    )
  },
}
