import type { InvitationDtoType, InvitationListItemDtoType } from '@/shared/invitation/dtos'
import { isManualResendEligibleDelivery } from '@/shared/invitation/entities/emailDelivery'
import { toInvitationListItemResponse, toInvitationResponse } from '@/shared/invitation/mappers'
import { invitationRepository } from '@/shared/invitation/repositories'
import { invitationEmailResendRepository, invitationEmailResendResults } from '@/shared/invitation/repositories/emailResend'
import { getInvitationEmailConfig } from '@/shared/invitation/services/emailConfig'
import type { MemberDtoType } from '@/shared/membership/dtos'
import type { Role } from '@/shared/membership/entities'
import { toMemberResponse } from '@/shared/membership/mappers'
import { type MembershipPageBoundary, membershipRepository } from '@/shared/membership/repositories'
import type { OrganizationDtoType } from '@/shared/organization/dtos'
import { toOrganizationResponse } from '@/shared/organization/mappers'
import { organizationRepository } from '@/shared/organization/repositories'
import { userRepository } from '@/shared/user/repositories'
import { AppError } from '@/utils/errors'

import type { AuditLogListDtoType, MemberListDtoType, OrganizationListDtoType } from '../dtos'
import {
  decodeAuditLogCursor,
  decodeMemberListCursor,
  encodeAuditLogCursor,
  encodeMemberListCursor,
  toAuditLogListResponse,
  toMemberListResponse,
  toOrganizationListResponse,
} from '../mappers'
import {
  type AuditLogPageBoundary,
  leaveOrganizationResults,
  memberRemovalResults,
  memberRoleChangeResults,
  organizationAuditLogRepository,
  organizationMemberRemovalRepository,
  organizationMemberRoleRepository,
  organizationMembershipRepository,
  organizationOwnershipRepository,
  ownershipTransferResults,
} from '../repositories'
import type {
  AddMemberBodySchemaType,
  CreateInvitationBodySchemaType,
  CreateOrganizationSchemaType,
  UpdateMemberRoleBodySchemaType,
  UpdateOrganizationSchemaType,
} from '../schemas'

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
 * ロック後に確定した操作者・対象のロールに対して、ロール変更の認可規則を適用する。
 * 許可なら `null`、拒否ならステータス付きの `AppError` を返す（repositoryはHTTPエラーを知らないため、返却値を呼び出し側でthrowする）。
 * 判定順は通常時のエラー順（操作者の権限 → 対象OWNER → ADMINの制限）に揃える。
 */
const authorizeMemberRoleChange = (operatorRole: Role, targetRole: Role, newRole: Role): AppError | null => {
  if (operatorRole === 'MEMBER') {
    return new AppError(403, 'この操作には管理者以上の権限が必要です')
  }
  if (targetRole === 'OWNER') {
    return new AppError(409, 'OWNERのロールは変更できません')
  }
  if (operatorRole === 'ADMIN' && targetRole === 'ADMIN') {
    return new AppError(403, 'ADMINは他のADMINを操作できません')
  }
  if (operatorRole === 'ADMIN' && newRole === 'ADMIN') {
    return new AppError(403, 'ADMINはADMINへの昇格を実行できません')
  }
  return null
}

/**
 * ロック後に確定した操作者・対象のロールに対して、メンバー削除の認可規則を適用する。
 * 許可なら `null`、拒否ならステータス付きの `AppError` を返す。
 * 判定順は操作者の権限 → 対象の存在 → 対象OWNER → ADMINの制限。操作者がMEMBERなら対象が存在しなくても403にする。
 * 対象が存在しない（`targetRole` が `null`）場合は、操作者の権限だけ確認して `null` を返し、404への変換はrepositoryの結果に任せる。
 */
const authorizeMemberRemoval = (operatorRole: Role, targetRole: Role | null): AppError | null => {
  if (operatorRole === 'MEMBER') {
    return new AppError(403, 'この操作には管理者以上の権限が必要です')
  }
  if (targetRole === null) {
    return null
  }
  if (targetRole === 'OWNER') {
    return new AppError(409, 'OWNERは削除できません')
  }
  if (operatorRole === 'ADMIN' && targetRole === 'ADMIN') {
    return new AppError(403, 'ADMINは他のADMINを削除できません')
  }
  return null
}

/**
 * organizations featureのユースケースを提供するサービス。
 * ロール要求（ADMIN以上 / OWNERのみ）の判定もここで行う。
 */
export const organizationsService = {
  /**
   * 組織を作成する。作成者はOWNERとして登録される。
   */
  create: async (userId: number, input: CreateOrganizationSchemaType): Promise<OrganizationDtoType> => {
    const organization = await organizationRepository.createWithOwner(input.name, userId)
    return toOrganizationResponse(organization)
  },

  /**
   * 認証済みユーザーが所属する組織の一覧をオフセット式で1ページ分返す。
   * 次ページの有無は `limit + 1` 件の取得で判定し、レスポンスのitemsは `limit` 件以下にする。
   */
  listMine: async (userId: number, limit: number, offset: number): Promise<OrganizationListDtoType> => {
    const organizations = await organizationRepository.findPageByUserId(userId, limit + 1, offset)
    const hasNext = organizations.length > limit
    return toOrganizationListResponse(organizations.slice(0, limit), limit, offset, hasNext)
  },

  /**
   * 指定IDの組織情報を返す（メンバーであることはミドルウェアで確認済み）。
   */
  getById: async (organizationId: number): Promise<OrganizationDtoType> => {
    const organization = await organizationRepository.findById(organizationId)
    if (!organization) {
      throw new AppError(404, '組織が見つかりません')
    }
    return toOrganizationResponse(organization)
  },

  /**
   * 組織を更新する。ADMIN以上のロールが必要。
   */
  update: async (organizationId: number, input: UpdateOrganizationSchemaType, role: Role): Promise<OrganizationDtoType> => {
    if (role !== 'OWNER' && role !== 'ADMIN') {
      throw new AppError(403, 'この操作には管理者以上の権限が必要です')
    }
    const organization = await organizationRepository.update(organizationId, input)
    if (!organization) {
      throw new AppError(404, '組織が見つかりません')
    }
    return toOrganizationResponse(organization)
  },

  /**
   * 組織を削除する。OWNERのみ実行できる。
   */
  remove: async (organizationId: number, role: Role): Promise<void> => {
    if (role !== 'OWNER') {
      throw new AppError(403, 'この操作にはオーナー権限が必要です')
    }
    const deleted = await organizationRepository.deleteById(organizationId)
    if (!deleted) {
      throw new AppError(404, '組織が見つかりません')
    }
  },

  /**
   * 現在のOWNERから同じ組織のADMINまたはMEMBERへ所有権を移譲する。
   */
  transferOwnership: async (organizationId: number, currentOwnerUserId: number, operatorRole: Role, targetMembershipId: number): Promise<void> => {
    if (operatorRole !== 'OWNER') {
      throw new AppError(403, 'この操作にはオーナー権限が必要です')
    }

    const result = await organizationOwnershipRepository.transferOwnership(organizationId, currentOwnerUserId, targetMembershipId)
    if (result === ownershipTransferResults.transferred) {
      return
    }
    if (result === ownershipTransferResults.targetNotFound) {
      throw new AppError(404, 'メンバーが見つかりません')
    }
    if (result === ownershipTransferResults.selfTransfer) {
      throw new AppError(422, '自分自身へ所有権を移譲することはできません')
    }
    throw new AppError(409, '競合により所有権を移譲できませんでした')
  },

  /**
   * 認証ユーザー自身を組織から脱退させる。OWNERは先に所有権を移譲する必要がある。
   */
  leave: async (organizationId: number, userId: number): Promise<void> => {
    const result = await organizationMembershipRepository.leave(organizationId, userId)
    if (result === leaveOrganizationResults.left) {
      return
    }
    if (result === leaveOrganizationResults.notMember) {
      throw new AppError(404, '組織が見つかりません')
    }
    if (result === leaveOrganizationResults.owner) {
      throw new AppError(409, 'OWNERは組織から脱退できません。先に所有権を移譲してください')
    }
    throw new AppError(409, '競合により組織から脱退できませんでした')
  },

  /**
   * 組織のメンバー一覧をカーソル式で1ページ分返す。MEMBER以上であれば閲覧可（ミドルウェアで確認済み）。
   * カーソルは境界値としてのみ使い、基準行が削除されても続きが取得できる（行の存在に依存しない）。
   * 次ページの有無は `limit + 1` 件の取得で判定し、レスポンスのitemsは `limit` 件以下にする。
   * 形式が不正なカーソルと、別組織で発行されたカーソルはどちらも400とする。
   */
  listMembers: async (organizationId: number, limit: number, cursor?: string): Promise<MemberListDtoType> => {
    let boundary: MembershipPageBoundary | null = null
    if (cursor !== undefined) {
      const decoded = decodeMemberListCursor(cursor)
      if (decoded === null || decoded.organizationId !== organizationId) {
        throw new AppError(400, 'カーソルが不正です')
      }
      boundary = { createdAt: decoded.createdAt, id: decoded.id }
    }

    // 認可はカーソル内の組織情報ではなく、引数で渡された認可済みのorganizationIdで毎回適用する
    const memberships = await membershipRepository.findPageByOrganization(organizationId, limit + 1, boundary)
    const items = memberships.slice(0, limit)
    const last = items.at(-1)
    const nextCursor =
      memberships.length > limit && last !== undefined ? encodeMemberListCursor({ organizationId, createdAt: last.createdAt, id: last.id }) : null

    return toMemberListResponse(items, nextCursor)
  },

  /**
   * 組織の監査ログを新しい順にカーソル式で1ページ分返す。OWNER/ADMINのみ閲覧可（ミドルウェアで確認済み）。
   * カーソルは境界値としてのみ使い、基準行が削除されても続きが取得できる（行の存在に依存しない）。
   * 次ページの有無は `limit + 1` 件の取得で判定し、レスポンスのitemsは `limit` 件以下にする。
   * 形式が不正なカーソル、別APIで発行されたカーソル（kind不一致）、別組織で発行されたカーソルはいずれも400とする。
   */
  listAuditLogs: async (organizationId: number, limit: number, cursor?: string): Promise<AuditLogListDtoType> => {
    let boundary: AuditLogPageBoundary | null = null
    if (cursor !== undefined) {
      const decoded = decodeAuditLogCursor(cursor)
      if (decoded === null || decoded.organizationId !== organizationId) {
        throw new AppError(400, 'カーソルが不正です')
      }
      boundary = { createdAt: decoded.createdAt, id: decoded.id }
    }

    // 認可はカーソル内の組織情報ではなく、引数で渡された認可済みのorganizationIdで毎回適用する
    const auditLogs = await organizationAuditLogRepository.findPageByOrganization(organizationId, limit + 1, boundary)
    const items = auditLogs.slice(0, limit)
    const last = items.at(-1)
    const nextCursor = auditLogs.length > limit && last !== undefined ? encodeAuditLogCursor({ organizationId, createdAt: last.createdAt, id: last.id }) : null

    return toAuditLogListResponse(items, nextCursor)
  },

  /**
   * メンバーを追加する。
   * OWNERはMEMBER/ADMINを追加可。ADMINはMEMBERのみ追加可。MEMBERは操作不可。
   */
  addMember: async (organizationId: number, operatorRole: Role, input: AddMemberBodySchemaType): Promise<MemberDtoType> => {
    if (input.role === 'OWNER') {
      throw new AppError(422, 'OWNERは追加できません')
    }
    if (operatorRole === 'MEMBER') {
      throw new AppError(403, 'この操作には管理者以上の権限が必要です')
    }
    if (operatorRole === 'ADMIN' && input.role === 'ADMIN') {
      throw new AppError(403, 'ADMINはMEMBERのみ追加できます')
    }
    const user = await userRepository.findByEmail(input.email)
    if (!user) {
      throw new AppError(404, 'ユーザーが見つかりません')
    }
    const existing = await membershipRepository.findByUserAndOrganization(user.id, organizationId)
    if (existing) {
      throw new AppError(409, '既にこの組織のメンバーです')
    }
    const membership = await membershipRepository.create(user.id, organizationId, input.role)
    if (!membership) {
      throw new AppError(409, '既にこの組織のメンバーです')
    }
    return toMemberResponse(membership)
  },

  /**
   * メンバーのロールを変更する。実際にロールが変わったときは監査ログを同じtransactionで記録する。
   * OWNERはADMIN/MEMBERへ変更可。ADMINはMEMBERのみ操作可でADMINへの昇格不可。MEMBERは操作不可。
   * 対象がOWNERの場合は操作不可（OWNERは自身に対しても含む）。
   *
   * 引数の `operatorRole` はmiddlewareが読んだ値で、通常時のエラー順を保つ事前判定にだけ使う。
   * 最終的な認可は、repositoryがロックした後の最新ロールに同じ規則を適用して判定する。
   * 同じロールの指定は許可されるが、実変更ではないため記録しない。
   */
  updateMemberRole: async (
    organizationId: number,
    membershipId: number,
    actorUserId: number,
    operatorRole: Role,
    input: UpdateMemberRoleBodySchemaType,
  ): Promise<MemberDtoType> => {
    if (input.role === 'OWNER') {
      throw new AppError(422, 'OWNERへの変更はできません')
    }
    if (operatorRole === 'MEMBER') {
      throw new AppError(403, 'この操作には管理者以上の権限が必要です')
    }

    const result = await organizationMemberRoleRepository.changeRoleWithAuditLog<AppError>(
      { organizationId, targetMembershipId: membershipId, actorUserId, newRole: input.role },
      (locked) => authorizeMemberRoleChange(locked.operatorRole, locked.targetRole, input.role),
    )

    // 成功値を明示的に判定し、未知の結果を暗黙の成功として扱わない。
    if (result.status === memberRoleChangeResults.changed || result.status === memberRoleChangeResults.unchanged) {
      return toMemberResponse(result.membership)
    }
    if (result.status === memberRoleChangeResults.organizationNotFound) {
      throw new AppError(404, '組織が見つかりません')
    }
    if (result.status === memberRoleChangeResults.targetNotFound) {
      throw new AppError(404, 'メンバーが見つかりません')
    }
    if (result.status === memberRoleChangeResults.rejected) {
      throw result.rejection
    }
    if (result.status === memberRoleChangeResults.conflict) {
      throw new AppError(409, '競合によりロールを変更できませんでした')
    }
    throw new Error('メンバーロール変更の結果が不明です')
  },

  /**
   * メンバーを削除し、監査ログ（MEMBER_REMOVED）を同じtransactionで記録する。
   * OWNERはADMIN/MEMBERを削除可。ADMINはMEMBERのみ削除可。MEMBERは操作不可。
   * 対象がOWNERの場合は操作不可（OWNERは自身に対しても含む）。
   *
   * 認可はmiddlewareが読んだロールではなく、repositoryがロックした後の最新ロールに対して判定する。
   * そのため操作者のロールは引数で受け取らず、認証済みユーザーIDだけを受け取る。
   */
  removeMember: async (organizationId: number, membershipId: number, actorUserId: number): Promise<void> => {
    const result = await organizationMemberRemovalRepository.removeWithAuditLog<AppError>(
      { organizationId, targetMembershipId: membershipId, actorUserId },
      (locked) => authorizeMemberRemoval(locked.operatorRole, locked.targetRole),
    )

    // 成功値を明示的に判定し、未知の結果を暗黙の成功として扱わない。
    if (result.status === memberRemovalResults.removed) {
      return
    }
    if (result.status === memberRemovalResults.organizationNotFound) {
      throw new AppError(404, '組織が見つかりません')
    }
    if (result.status === memberRemovalResults.targetNotFound) {
      throw new AppError(404, 'メンバーが見つかりません')
    }
    if (result.status === memberRemovalResults.rejected) {
      throw result.rejection
    }
    throw new Error('メンバー削除の結果が不明です')
  },

  /**
   * 招待を作成する。
   * OWNERはADMIN/MEMBERを招待可。ADMINはMEMBERのみ招待可。MEMBERは操作不可。
   * 既にPENDINGの招待がある場合、または対象メールが既にメンバーの場合は409。
   */
  createInvitation: async (organizationId: number, operatorRole: Role, input: CreateInvitationBodySchemaType): Promise<InvitationDtoType> => {
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
  listInvitations: async (organizationId: number, operatorRole: Role): Promise<InvitationListItemDtoType[]> => {
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
  cancelInvitation: async (organizationId: number, invitationId: number, operatorRole: Role): Promise<void> => {
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
  resendInvitationEmail: async (organizationId: number, invitationId: number, actorUserId: number): Promise<void> => {
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
