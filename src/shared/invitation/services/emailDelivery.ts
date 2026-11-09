import { deliverResendEmail, resendDeliveryTimeoutMs } from '@/libs/resend'

import { invitationEmailLimits } from '../entities/emailDelivery'
import { type ClaimedInvitationEmail, type InvitationEmailClaim, invitationEmailDeliveryRepository } from '../repositories/emailDelivery'

const retryDelayMinutes = [15, 30, 60, 120]
const batchSize = 30

/** 既存配信が参照する版の本文を固定し、変更時は新しい版を追加する。 */
const renderEmail = (delivery: ClaimedInvitationEmail): Parameters<typeof deliverResendEmail>[0] => {
  return {
    from: delivery.fromEmail,
    to: delivery.invitation.email,
    subject: '組織への招待',
    text: [
      `組織「${delivery.organizationName}」への招待です。`,
      `有効期限（UTC） ${delivery.invitation.expiresAt.toISOString()}`,
      '',
      delivery.scalarUrl,
      'このページを開くには、アクセスを許可されたGoogleアカウントでIAPにログインしてください。',
      'アプリのアカウントをお持ちの場合は、POST /auth/login でログインし、POST /invitations/accept を実行してください。',
      '未登録の場合は、POST /invitations/signup でアカウントを作成し、組織へ参加してください。',
      '以下のトークンを受諾または登録リクエストの本文の token 欄へ貼り付けてください。',
      '',
      delivery.invitation.token,
    ].join('\n'),
  }
}

/** 招待の状態と処理権を確認してから送信し、受付結果に応じて次回時刻または終端状態を保存する。 */
const processClaim = async (claim: InvitationEmailClaim): Promise<void> => {
  const delivery = await invitationEmailDeliveryRepository.readClaim(claim)
  const now = Date.now()
  if (!delivery?.leaseUntil || delivery.leaseUntil.getTime() <= now) return

  const deadline = Math.min(claim.deadline.getTime(), delivery.invitation.expiresAt.getTime())
  const exhausted = claim.previousAttemptCount >= invitationEmailLimits.maxAttempts
  if (delivery.invitation.status !== 'PENDING' || now >= deadline || exhausted) {
    await invitationEmailDeliveryRepository.finish(claim, {
      status: claim.hasUnknownOutcome ? 'UNKNOWN' : 'SKIPPED',
      attemptCount: claim.previousAttemptCount,
      lastError: delivery.invitation.status !== 'PENDING' ? 'inactive' : now >= deadline ? 'expired' : 'attempt_limit',
    })
    return
  }

  if (delivery.leaseUntil.getTime() <= now + resendDeliveryTimeoutMs) {
    // 送信前に処理権を解放し、次回確保時にこの試行を受付結果不明として扱わない。
    await invitationEmailDeliveryRepository.finish(claim, {
      attemptCount: claim.previousAttemptCount,
      nextAttemptAt: new Date(Math.min(now + retryDelayMinutes[0] * 60_000, deadline)),
    })
    return
  }

  // 旧Jobが未対応の版を読んだ場合も、送信せず次回時刻を更新して後続の配信に進む。
  const result =
    delivery.templateVersion === 1
      ? await deliverResendEmail(renderEmail(delivery), claim.id)
      : ({ kind: 'retry', reason: 'template_version', unknown: false } as const)
  if (result.kind === 'accepted') {
    await invitationEmailDeliveryRepository.finish(claim, { status: 'ACCEPTED', resendEmailId: result.emailId, lastError: null, hasUnknownOutcome: false })
    return
  }

  const hasUnknownOutcome = claim.hasUnknownOutcome || (result.kind === 'retry' && result.unknown)
  const finishedAt = Date.now()
  if (result.kind === 'retry' && claim.attemptCount < invitationEmailLimits.maxAttempts && finishedAt < deadline) {
    const delayMs = retryDelayMinutes[claim.attemptCount - 1] * 60_000
    await invitationEmailDeliveryRepository.finish(claim, {
      nextAttemptAt: new Date(Math.min(finishedAt + delayMs, deadline)),
      hasUnknownOutcome,
      lastError: result.reason,
    })
    return
  }

  await invitationEmailDeliveryRepository.finish(claim, {
    status: hasUnknownOutcome ? 'UNKNOWN' : result.reason === 'template_version' ? 'SKIPPED' : 'REJECTED',
    hasUnknownOutcome,
    lastError: result.reason,
  })
}

/** 期限の来た配信を1回の起動につき最大30件処理する。 */
export const deliverInvitationEmails = async (): Promise<number> => {
  let processed = 0
  let failed = false
  for (; processed < batchSize; processed++) {
    const claim = await invitationEmailDeliveryRepository.claim()
    if (!claim) break
    try {
      await processClaim(claim)
    } catch {
      // DBや外部APIの例外には機密情報が含まれうるため、識別子と回数だけを記録する。
      console.error('招待メールの配信処理に失敗しました', { deliveryId: claim.id, attemptCount: claim.attemptCount })
      failed = true
    }
  }
  if (failed) throw new Error('招待メールの配信処理に失敗しました')
  return processed
}
