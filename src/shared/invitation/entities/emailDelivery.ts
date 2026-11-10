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
