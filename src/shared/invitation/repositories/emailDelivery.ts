import type { InvitationEmailDelivery, InvitationStatus, Prisma } from '@/generated/prisma/client'
import { prisma } from '@/libs/prisma'

import { invitationEmailLimits } from '../entities/emailDelivery'

export type InvitationEmailClaim = Pick<InvitationEmailDelivery, 'id' | 'leaseToken' | 'attemptCount' | 'hasUnknownOutcome' | 'deadline'> & {
  leaseToken: string
  previousAttemptCount: number
}

export type ClaimedInvitationEmail = Pick<InvitationEmailDelivery, 'fromEmail' | 'scalarUrl' | 'organizationName' | 'templateVersion'> & {
  leaseUntil: Date | null
  invitation: { email: string; token: string; expiresAt: Date; status: InvitationStatus }
}

type EmailDeliveryResult = Pick<
  Prisma.InvitationEmailDeliveryUpdateManyMutationInput,
  'status' | 'attemptCount' | 'nextAttemptAt' | 'hasUnknownOutcome' | 'resendEmailId' | 'lastError'
>

/** 配信を1件ずつ確保し、取得した処理権が有効な間だけ結果を反映する。 */
export const invitationEmailDeliveryRepository = {
  /** 行ロックの取得と処理権の発行を単一SQLのトランザクションで行う。 */
  claim: async (): Promise<InvitationEmailClaim | undefined> => {
    const leaseToken = crypto.randomUUID()
    const [claim] = await prisma.$queryRaw<InvitationEmailClaim[]>`
      WITH candidate AS (
        SELECT id, "attemptCount"
        FROM "InvitationEmailDelivery"
        WHERE status = 'PENDING'
          AND "nextAttemptAt" <= timezone('UTC', statement_timestamp())
          AND ("leaseUntil" IS NULL OR "leaseUntil" <= timezone('UTC', statement_timestamp()))
        ORDER BY "nextAttemptAt", id
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "InvitationEmailDelivery" AS delivery
      SET "leaseToken" = ${leaseToken},
          "leaseUntil" = timezone('UTC', statement_timestamp()) + ${invitationEmailLimits.leaseMs} * interval '1 millisecond',
          "attemptCount" = LEAST(candidate."attemptCount" + 1, ${invitationEmailLimits.maxAttempts}),
          "hasUnknownOutcome" = delivery."hasUnknownOutcome" OR delivery."leaseUntil" IS NOT NULL
      FROM candidate
      WHERE delivery.id = candidate.id
      RETURNING delivery.id, delivery."leaseToken", delivery."attemptCount",
                delivery."hasUnknownOutcome", delivery.deadline,
                candidate."attemptCount" AS "previousAttemptCount"
    `
    return claim
  },

  /** 送信直前に処理権を確認し、招待の現在の状態と送信に必要な項目を取得する。 */
  readClaim: async ({ id, leaseToken }: InvitationEmailClaim): Promise<ClaimedInvitationEmail | null> => {
    return prisma.invitationEmailDelivery.findFirst({
      where: { id, leaseToken, leaseUntil: { gt: new Date() } },
      select: {
        leaseUntil: true,
        fromEmail: true,
        scalarUrl: true,
        organizationName: true,
        templateVersion: true,
        invitation: { select: { email: true, token: true, expiresAt: true, status: true } },
      },
    })
  },

  /** 削除または処理権の失効・交代による更新0件は正常に扱う。 */
  finish: async ({ id, leaseToken }: InvitationEmailClaim, result: EmailDeliveryResult): Promise<void> => {
    await prisma.invitationEmailDelivery.updateMany({
      where: { id, leaseToken, leaseUntil: { gt: new Date() } },
      data: { ...result, leaseToken: null, leaseUntil: null },
    })
  },
}
