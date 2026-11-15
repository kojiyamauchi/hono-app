import type { InvitationDtoType, InvitationListItemDtoType } from '@/shared/invitation/dtos'
import { isManualResendEligibleDelivery } from '@/shared/invitation/entities/emailDelivery'
import { toInvitationListItemResponse, toInvitationResponse } from '@/shared/invitation/mappers'
import { invitationRepository } from '@/shared/invitation/repositories'
import { invitationEmailResendRepository, invitationEmailResendResults } from '@/shared/invitation/repositories/emailResend'
import { getInvitationEmailConfig } from '@/shared/invitation/services/emailConfig'
import type { Role } from '@/shared/membership/entities'
import { membershipRepository } from '@/shared/membership/repositories'
import { userRepository } from '@/shared/user/repositories'
import { AppError } from '@/utils/errors'

import type { CreateBodySchemaType } from '../schemas/invitations'

/**
 * 招待メールを再送できる、操作者のロールごとの宛先ロール。
 * 許可表に載っていない組み合わせ（OWNER宛て、ADMINからADMIN宛てなど）は再送できない。
 */
const resendTargetRoles: Record<Role, readonly Role[]> = {
  OWNER: ['ADMIN', 'MEMBER'],
  ADMIN: ['MEMBER'],
  MEMBER: [],
}

/**
 * 組織の招待操作のユースケースを提供するサービス。
 */
export const invitationsService = {
  /**
   * 招待を作成する。
   * OWNERはADMIN/MEMBERを招待可。ADMINはMEMBERのみ招待可。MEMBERは操作不可。
   * 既にPENDINGの招待がある場合、または対象メールが既にメンバーの場合は409。
   */
  create: async (organizationId: number, operatorRole: Role, input: CreateBodySchemaType): Promise<InvitationDtoType> => {
    if (operatorRole === 'MEMBER') {
      throw new AppError(403, 'この操作には管理者以上の権限が必要です')
    }
    if (input.role === 'OWNER') {
      throw new AppError(422, 'OWNERは招待できません')
    }
    if (operatorRole === 'ADMIN' && input.role === 'ADMIN') {
      throw new AppError(403, 'ADMINはMEMBERのみ招待できます')
    }
    const existingInvitation = await invitationRepository.findPendingByOrgAndEmail(organizationId, input.email)
    if (existingInvitation) {
      throw new AppError(409, 'このメールアドレスへの招待は既に作成済みです')
    }
    const existingUser = await userRepository.findByEmail(input.email)
    if (existingUser) {
      const existingMembership = await membershipRepository.findByUserAndOrganization(existingUser.id, organizationId)
      if (existingMembership) {
        throw new AppError(409, 'このユーザーは既に組織のメンバーです')
      }
    }
    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const delivery = getInvitationEmailConfig()
    const invitation = await invitationRepository.create(organizationId, input.email, input.role, token, expiresAt, delivery).catch((error: unknown) => {
      if (!delivery) throw error
      console.error('招待と配信待ちの保存に失敗しました', { organizationId })
      throw new AppError(500, 'サーバーエラーが発生しました')
    })
    if (!invitation) {
      throw new AppError(409, 'このメールアドレスへの招待は既に作成済みです')
    }
    return toInvitationResponse(invitation)
  },

  /**
   * 招待一覧を返す。OWNER/ADMINのみ閲覧可。デフォルトはPENDINGのみ。
   * 各招待にDB保存済みの招待メール配信状態（配信記録なしはnull）を付与する。時刻や設定からの推定はしない。
   */
  list: async (organizationId: number, operatorRole: Role): Promise<InvitationListItemDtoType[]> => {
    if (operatorRole === 'MEMBER') {
      throw new AppError(403, 'この操作には管理者以上の権限が必要です')
    }
    const invitations = await invitationRepository.findAllByOrganization(organizationId)
    return invitations.map(toInvitationListItemResponse)
  },

  /**
   * 招待をキャンセルする。
   * OWNERはADMIN/MEMBER宛ての招待をキャンセル可。ADMINはMEMBER宛てのみキャンセル可。
   * PENDING以外の招待はキャンセル不可（409）。
   */
  cancel: async (organizationId: number, invitationId: number, operatorRole: Role): Promise<void> => {
    if (operatorRole === 'MEMBER') {
      throw new AppError(403, 'この操作には管理者以上の権限が必要です')
    }
    const target = await invitationRepository.findById(invitationId)
    if (!target || target.organizationId !== organizationId) {
      throw new AppError(404, '招待が見つかりません')
    }
    if (target.status !== 'PENDING') {
      throw new AppError(409, 'PENDING状態の招待のみキャンセルできます')
    }
    if (operatorRole === 'ADMIN' && target.role === 'ADMIN') {
      throw new AppError(403, 'ADMINはADMIN宛ての招待をキャンセルできません')
    }
    const canceled = await invitationRepository.cancel(invitationId)
    if (!canceled) {
      throw new AppError(409, 'PENDING状態の招待のみキャンセルできます')
    }
  },

  /**
   * 招待メールの再送を受け付け、配信待ちの保存までを行う（Resendは呼ばない）。
   * 判定順は 所属(404) → 操作者ロール(403) → 招待(404) → 対象ロール(403) → 再送受付済み(409)
   * → 配信設定・招待状態・期限・再送対象(409、設定不備は500) → 保存。
   *
   * 認可と状態の判定はmiddlewareの値ではなく、repositoryがロックした後の最新の所属・ロール・招待・配信に対して行う。
   * そのため操作者のロールは引数で受け取らず、認証済みユーザーIDだけを受け取る。
   * 配信設定はrepository呼び出し前に取得するが、設定不備による500は判定順の該当位置まで保留する。
   */
  resendEmail: async (organizationId: number, invitationId: number, actorUserId: number): Promise<void> => {
    let snapshot: ReturnType<typeof getInvitationEmailConfig> = undefined
    let configFailed = false
    try {
      snapshot = getInvitationEmailConfig()
    } catch {
      configFailed = true
    }

    const result = await invitationEmailResendRepository
      .requestResend<AppError>(
        { organizationId, invitationId, actorUserId, snapshot: snapshot ?? null },
        {
          authorizeOperator: ({ operatorRole }) => {
            return operatorRole === 'MEMBER' ? new AppError(403, 'この操作には管理者以上の権限が必要です') : null
          },
          authorizeTarget: ({ operatorRole, invitation }) => {
            if (!invitation) {
              return new AppError(404, '招待が見つかりません')
            }
            // 許可表に載っていない組み合わせ（OWNER宛て、ADMINからADMIN宛てなど）はすべて拒否する。
            if (!resendTargetRoles[operatorRole].includes(invitation.role)) {
              return new AppError(403, 'この宛先ロールの招待メールを再送する権限がありません')
            }
            return null
          },
          evaluate: ({ invitation, delivery, now }) => {
            if (delivery?.manualResendRequestedAt) {
              return new AppError(409, 'この招待メールの再送は既に受け付けています')
            }
            if (configFailed) {
              console.error('招待メールの配信設定が不正です', { organizationId })
              return new AppError(500, 'サーバーエラーが発生しました')
            }
            if (!snapshot) {
              return new AppError(409, '招待メールの配信が有効ではありません')
            }
            if (invitation.status !== 'PENDING') {
              return new AppError(409, 'PENDING状態の招待のみメールを再送できます')
            }
            // ワーカーの送信前判定と同じ境界で、期限と判定時刻が等しい場合も期限切れとして扱う。
            if (invitation.expiresAt.getTime() <= now.getTime()) {
              return new AppError(409, '招待の有効期限が切れています')
            }
            if (!delivery || !isManualResendEligibleDelivery(delivery)) {
              return new AppError(409, 'この招待メールは再送できません')
            }
            return null
          },
        },
      )
      .catch(() => {
        console.error('招待メールの再送待ちの保存に失敗しました', { organizationId })
        throw new AppError(500, 'サーバーエラーが発生しました')
      })

    // 成功値を明示的に判定し、未知の結果を暗黙の成功として扱わない。
    if (result.status === invitationEmailResendResults.requested) {
      return
    }
    if (result.status === invitationEmailResendResults.organizationNotFound) {
      throw new AppError(404, '組織が見つかりません')
    }
    if (result.status === invitationEmailResendResults.rejected) {
      throw result.rejection
    }
    throw new Error('招待メール再送の結果が不明です')
  },
}
