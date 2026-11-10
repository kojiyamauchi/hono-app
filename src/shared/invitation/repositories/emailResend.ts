import type { InvitationEmailDeliveryStatus, InvitationStatus } from '@/generated/prisma/client'
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
  /** 操作者（認証済みユーザー）のユーザーID。 */
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

/**
 * 判定コールバックが受け取る、ロック後に確定した最新の状態。
 * `now` は全ロック取得後に取得した判定時刻で、期限判定と再送受付時刻に使う。
 */
export type LockedResendState = {
  operatorRole: Role
  /** 組織内に存在しない（または別組織の）招待は `null`。 */
  invitation: LockedResendInvitation | null
  /** 配信行がない招待は `null`。 */
  delivery: LockedResendDelivery | null
  now: Date
}

/**
 * ロック後の状態で認可・再送可否を判定する同期コールバック。許可なら `null`、拒否なら拒否値を返す。
 * ロック中に待たせないため、DBアクセスや非同期処理は行わない。
 */
export type AuthorizeInvitationEmailResend<TRejection> = (state: LockedResendState) => TRejection | null

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
   * → 配信行(`FOR UPDATE`)の順にロックし、最新の状態を `authorize` で判定する。
   * 許可された場合だけ、既存の配信行を新しい配信IDの配信待ちへ置き換え、再送受付時刻を同じtransactionで確定する。
   * 配信行はInvitation行の確保後に別のSQLで読み、置き換え後の行を後続が読めるようにする（READ COMMITTED）。
   * 判定時刻は全ロック取得後に取得する。招待のステータスは更新しない（期限切れでもEXPIREDにしない）。
   */
  requestResend: async <TRejection>(
    input: RequestInvitationEmailResendInput,
    authorize: AuthorizeInvitationEmailResend<TRejection>,
  ): Promise<InvitationEmailResendResult<TRejection>> => {
    const { organizationId, invitationId, actorUserId, snapshot } = input

    return prisma.$transaction(async (tx): Promise<InvitationEmailResendResult<TRejection>> => {
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

      const [invitation] = await tx.$queryRaw<LockedInvitationRow[]>`
        SELECT id, role::text AS role, status::text AS status, "expiresAt"
        FROM "Invitation"
        WHERE id = ${invitationId} AND "organizationId" = ${organizationId}
        FOR NO KEY UPDATE
      `
      const [delivery] = invitation
        ? await tx.$queryRaw<LockedDeliveryRow[]>`
            SELECT status::text AS status, "hasUnknownOutcome", "lastError", "manualResendRequestedAt"
            FROM "InvitationEmailDelivery"
            WHERE "invitationId" = ${invitation.id}
            FOR UPDATE
          `
        : []

      // 判定時刻は、すべてのロック待ちが終わった後に取得する。
      const now = new Date()
      const rejection = authorize({
        operatorRole: membership.role,
        invitation: invitation ? { role: invitation.role, status: invitation.status, expiresAt: invitation.expiresAt } : null,
        delivery: delivery ?? null,
        now,
      })
      if (rejection !== null) {
        return { status: invitationEmailResendResults.rejected, rejection }
      }
      if (!invitation || !delivery || !snapshot) {
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
    })
  },
}
