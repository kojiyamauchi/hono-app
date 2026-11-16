import { invitationRepository } from '@/shared/invitation/repositories'
import type { MemberDtoType } from '@/shared/membership/dtos'
import { toMemberResponse } from '@/shared/membership/mappers'
import { membershipRepository } from '@/shared/membership/repositories'
import { userRepository } from '@/shared/user/repositories'
import { AppError } from '@/utils/errors'

import { findPendingValidInvitation } from './common'

/**
 * 招待受諾のユースケースを提供するサービス。
 */
export const acceptService = {
  /**
   * 招待トークンを使って招待を受諾し、組織メンバーになる。
   *
   * 1. トークンからPENDINGかつ有効な招待を取得（無ければ404、不正ステータス/期限切れは409）
   * 2. 認証ユーザーのメールと招待のメールが一致しない場合は403
   * 3. 既にメンバーの場合は409
   * 4. トランザクションで招待をACCEPTEDに更新してmembershipを作成（nullなら409）
   */
  execute: async (userId: number, token: string): Promise<MemberDtoType> => {
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
}
