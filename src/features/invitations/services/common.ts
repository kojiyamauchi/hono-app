import type { Invitation } from '@/shared/invitation/entities'
import { invitationRepository } from '@/shared/invitation/repositories'
import { AppError } from '@/utils/errors'

/**
 * トークンで招待を取得し、PENDINGかつ有効期限内であることを検証して返す。
 * 招待が存在しない場合は404、PENDINGでない場合・期限切れの場合は409を投げる。
 * PENDINGでも有効期限切れの場合は遅延失効（EXPIRED更新）してから409を投げる。
 *
 * accept / decline / signup の共通前処理を担うhelper。
 */
export const findPendingValidInvitation = async (token: string): Promise<Invitation> => {
  // トークンで招待を取得
  const invitation = await invitationRepository.findByToken(token)
  if (!invitation) {
    throw new AppError(404, '招待が見つかりません')
  }

  // ステータス判定
  if (invitation.status === 'ACCEPTED') {
    throw new AppError(409, '既に受諾済みの招待です')
  }
  if (invitation.status === 'CANCELED') {
    throw new AppError(409, 'キャンセル済みの招待です')
  }
  if (invitation.status === 'EXPIRED') {
    throw new AppError(409, '招待の有効期限が切れています')
  }
  if (invitation.status === 'DECLINED') {
    throw new AppError(409, '既に辞退済みの招待です')
  }

  // 未知ステータスをfail-closedで止める（成功パスへの入口はPENDINGの肯定判定だけにする）
  if (invitation.status !== 'PENDING') {
    throw new AppError(409, 'この招待は利用できません')
  }

  // PENDINGでも有効期限切れの場合は遅延失効してから409
  if (invitation.expiresAt < new Date()) {
    await invitationRepository.markExpired(invitation.id)
    throw new AppError(409, '招待の有効期限が切れています')
  }

  return invitation
}
