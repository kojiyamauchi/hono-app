import { invitationRepository } from '@/shared/invitation/repositories'
import type { MemberResponse } from '@/shared/membership/dtos'
import { toMemberResponse } from '@/shared/membership/mappers'
import { membershipRepository } from '@/shared/membership/repositories'
import { userRepository } from '@/shared/user/repositories'
import { AppError } from '@/utils/errors'

/**
 * invitations featureのユースケースを提供するサービス。
 */
export const invitationsService = {
  /**
   * 招待トークンを使って招待を受諾し、組織メンバーになる。
   *
   * 1. トークンから招待を取得（無ければ404）
   * 2. ステータス判定（ACCEPTED/CANCELED/EXPIREDは409）
   * 3. PENDINGでも期限切れの場合は遅延失効してから409
   * 4. 認証ユーザーのメールと招待のメールが一致しない場合は403
   * 5. 既にメンバーの場合は409
   * 6. トランザクションで招待をACCEPTEDに更新してmembershipを作成（nullなら409）
   */
  accept: async (userId: number, token: string): Promise<MemberResponse> => {
    // 1. トークンで招待を取得
    const invitation = await invitationRepository.findByToken(token)
    if (!invitation) {
      throw new AppError(404, '招待が見つかりません')
    }

    // 2. ステータス判定
    if (invitation.status === 'ACCEPTED') {
      throw new AppError(409, '既に受諾済みの招待です')
    }
    if (invitation.status === 'CANCELED') {
      throw new AppError(409, 'キャンセル済みの招待です')
    }
    if (invitation.status === 'EXPIRED') {
      throw new AppError(409, '招待の有効期限が切れています')
    }

    // 3. PENDINGでも有効期限切れの場合は遅延失効してから409
    if (invitation.expiresAt < new Date()) {
      await invitationRepository.markExpired(invitation.id)
      throw new AppError(409, '招待の有効期限が切れています')
    }

    // 4. 認証ユーザーのメールと招待のメールを照合
    const user = await userRepository.findById(userId)
    if (!user) {
      throw new AppError(404, 'ユーザーが見つかりません')
    }
    if (user.email !== invitation.email) {
      throw new AppError(403, 'この招待はあなたのメールアドレス宛てではありません')
    }

    // 5. 既にメンバーの場合は409
    const existing = await membershipRepository.findByUserAndOrganization(userId, invitation.organizationId)
    if (existing) {
      throw new AppError(409, '既にこの組織のメンバーです')
    }

    // 6. トランザクションで招待をACCEPTEDに更新してmembershipを作成
    const membership = await invitationRepository.accept(invitation.id, invitation.organizationId, userId, invitation.role)
    if (!membership) {
      throw new AppError(409, '招待を受諾できませんでした')
    }

    return toMemberResponse(membership)
  },
}
