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
