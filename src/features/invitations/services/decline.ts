import { invitationRepository } from '@/shared/invitation/repositories'
import { AppError } from '@/utils/errors'

import { findPendingValidInvitation } from './common'

/**
 * 招待辞退のユースケースを提供するサービス。
 */
export const declineService = {
  /**
   * 招待トークンを使って招待を辞退する。
   *
   * 1. トークンからPENDINGかつ有効な招待を取得（無ければ404、不正ステータス/期限切れは409）
   * 2. 招待をDECLINEDに更新（falseなら競合で409）
   */
  execute: async (token: string): Promise<void> => {
    // 1. PENDINGかつ有効な招待を取得
    const invitation = await findPendingValidInvitation(token)

    // 2. 招待をDECLINEDに更新
    const declined = await invitationRepository.decline(invitation.id)
    if (!declined) {
      throw new AppError(409, '招待を辞退できませんでした')
    }
  },
}
