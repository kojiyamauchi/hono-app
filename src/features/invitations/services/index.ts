import type { InvitationDetailDtoType } from '@/shared/invitation/dtos'
import { toInvitationDetailResponse } from '@/shared/invitation/mappers'
import { invitationRepository } from '@/shared/invitation/repositories'
import { AppError } from '@/utils/errors'

/**
 * invitations featureのユースケースを提供するサービス。
 */
export const service = {
  /**
   * 招待トークンから招待詳細を取得する（読み取り専用）。
   *
   * 1. トークンとorganizationを一括取得（存在しない場合は404）
   * 2. 実効statusを算出: PENDINGかつexpiresAtが過去なら 'EXPIRED' として扱う（DBは更新しない）
   * 3. InvitationDetailDtoTypeを返す
   */
  getDetailByToken: async (token: string): Promise<InvitationDetailDtoType> => {
    // 1. トークンとorganizationを一括取得
    const result = await invitationRepository.findByTokenWithOrganization(token)
    if (!result) {
      throw new AppError(404, '招待が見つかりません')
    }

    const { organization, ...invitation } = result

    // 2. 実効statusを算出（PENDINGかつ期限切れはEXPIREDとして算出。DBは更新しない）
    const effectiveStatus = invitation.status === 'PENDING' && invitation.expiresAt < new Date() ? 'EXPIRED' : invitation.status

    // 3. 算出済みstatusを反映してmapperへ渡す
    return toInvitationDetailResponse({ ...invitation, status: effectiveStatus }, organization)
  },
}
