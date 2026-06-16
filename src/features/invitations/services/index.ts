import type { Invitation } from '@/shared/invitation/entities'
import { invitationRepository } from '@/shared/invitation/repositories'
import type { MemberResponse } from '@/shared/membership/dtos'
import { toMemberResponse } from '@/shared/membership/mappers'
import { membershipRepository } from '@/shared/membership/repositories'
import { userRepository } from '@/shared/user/repositories'
import { AppError } from '@/utils/errors'

/**
 * トークンで招待を取得し、PENDINGかつ有効期限内であることを検証して返す。
 * 招待が存在しない場合は404、PENDINGでない場合・期限切れの場合は409を投げる。
 * PENDINGでも有効期限切れの場合は遅延失効（EXPIRED更新）してから409を投げる。
 *
 * accept / decline の共通前処理を担う private helper。
 */
const findPendingValidInvitation = async (token: string): Promise<Invitation> => {
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

  // PENDINGでも有効期限切れの場合は遅延失効してから409
  if (invitation.expiresAt < new Date()) {
    await invitationRepository.markExpired(invitation.id)
    throw new AppError(409, '招待の有効期限が切れています')
  }

  return invitation
}

/**
 * invitations featureのユースケースを提供するサービス。
 */
export const invitationsService = {
  /**
   * 招待トークンを使って招待を受諾し、組織メンバーになる。
   *
   * 1. トークンからPENDINGかつ有効な招待を取得（無ければ404、不正ステータス/期限切れは409）
   * 2. 認証ユーザーのメールと招待のメールが一致しない場合は403
   * 3. 既にメンバーの場合は409
   * 4. トランザクションで招待をACCEPTEDに更新してmembershipを作成（nullなら409）
   */
  accept: async (userId: number, token: string): Promise<MemberResponse> => {
    // 1. PENDINGかつ有効な招待を取得
    const invitation = await findPendingValidInvitation(token)

    // 2. 認証ユーザーのメールと招待のメールを照合
    const user = await userRepository.findById(userId)
    if (!user) {
      throw new AppError(404, 'ユーザーが見つかりません')
    }
    if (user.email !== invitation.email) {
      throw new AppError(403, 'この招待はあなたのメールアドレス宛てではありません')
    }

    // 3. 既にメンバーの場合は409
    const existing = await membershipRepository.findByUserAndOrganization(userId, invitation.organizationId)
    if (existing) {
      throw new AppError(409, '既にこの組織のメンバーです')
    }

    // 4. トランザクションで招待をACCEPTEDに更新してmembershipを作成
    const membership = await invitationRepository.accept(invitation.id, invitation.organizationId, userId, invitation.role)
    if (!membership) {
      throw new AppError(409, '招待を受諾できませんでした')
    }

    return toMemberResponse(membership)
  },

  /**
   * 招待トークンを使って招待を辞退する。
   *
   * 1. トークンからPENDINGかつ有効な招待を取得（無ければ404、不正ステータス/期限切れは409）
   * 2. 招待をDECLINEDに更新（falseなら競合で409）
   */
  decline: async (token: string): Promise<void> => {
    // 1. PENDINGかつ有効な招待を取得
    const invitation = await findPendingValidInvitation(token)

    // 2. 招待をDECLINEDに更新
    const declined = await invitationRepository.decline(invitation.id)
    if (!declined) {
      throw new AppError(409, '招待を辞退できませんでした')
    }
  },
}
