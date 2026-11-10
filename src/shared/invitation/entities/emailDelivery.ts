import type { InvitationEmailDeliveryStatus as PrismaInvitationEmailDeliveryStatus } from '@/generated/prisma/client'

/**
 * 招待メール配信状態の値一覧。
 * 型・DTOのZod schema（`z.enum`）双方の正本として使い、列挙値の二重管理を防ぐ。
 */
export const invitationEmailDeliveryStatusValues = ['PENDING', 'ACCEPTED', 'REJECTED', 'UNKNOWN', 'SKIPPED'] as const

/**
 * 招待メール配信状態。
 */
export type InvitationEmailDeliveryStatus = (typeof invitationEmailDeliveryStatusValues)[number]

/** 2つの型が双方向に代入可能であるときだけ `true` になる型。 */
type IsMutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

/** 型引数が `true` でなければコンパイルエラーにする型アサーション。 */
type AssertTrue<T extends true> = T

/**
 * Prisma生成enumと値一覧が過不足なく一致していることをコンパイル時に保証する。
 * どちらかに値の追加・削除があると型エラーになる（ランタイムコードは生成しない）。
 */
export type _InvitationEmailDeliveryStatusMatchesPrisma = AssertTrue<IsMutuallyAssignable<InvitationEmailDeliveryStatus, PrismaInvitationEmailDeliveryStatus>>

/** 1件の配信に対する最大試行回数と有効時間。 */
export const invitationEmailLimits = {
  maxAttempts: 5,
  maxAgeMs: 6 * 60 * 60 * 1000,
  leaseMs: 60_000,
} as const

/** 招待の作成時点で固定する送信設定。 */
export type InvitationEmailSnapshot = {
  fromEmail: string
  scalarUrl: string
  templateVersion: number
}

/**
 * 配信の有効期限を求める。基準時刻から最大保持時間が経過した時刻と、招待の有効期限の早い方とする。
 * 招待作成時の配信待ちと手動再送の配信待ちで同じ規則を使う。
 */
export const calculateInvitationEmailDeadline = (baseTime: Date, invitationExpiresAt: Date): Date => {
  return new Date(Math.min(invitationExpiresAt.getTime(), baseTime.getTime() + invitationEmailLimits.maxAgeMs))
}

/** 手動再送の対象にできる、Resendが明示的に受付を拒否した理由。 */
export const manualResendEligibleErrors = ['client', 'rate_limited'] as const

/** 手動再送の可否判定に使う配信行の項目。 */
export type ManualResendDeliveryState = {
  status: InvitationEmailDeliveryStatus
  hasUnknownOutcome: boolean
  lastError: string | null
}

/**
 * 初回の配信結果が明示的な受付拒否（REJECTED・受付結果不明なし・client/rate_limited）かを判定する。
 * invalid_idempotencyは以前の依頼が受け付けられた可能性があるため対象外とする。
 */
export const isManualResendEligibleDelivery = (delivery: ManualResendDeliveryState): boolean => {
  return (
    delivery.status === 'REJECTED' &&
    !delivery.hasUnknownOutcome &&
    delivery.lastError !== null &&
    (manualResendEligibleErrors as readonly string[]).includes(delivery.lastError)
  )
}
