import type { InvitationResponse } from '@/shared/invitation/dtos'
import { toInvitationResponse } from '@/shared/invitation/mappers'
import { invitationRepository } from '@/shared/invitation/repositories'
import type { MemberResponse } from '@/shared/membership/dtos'
import type { Role } from '@/shared/membership/entities'
import { toMemberResponse } from '@/shared/membership/mappers'
import { membershipRepository } from '@/shared/membership/repositories'
import type { OrganizationResponse } from '@/shared/organization/dtos'
import { toOrganizationResponse } from '@/shared/organization/mappers'
import { organizationRepository } from '@/shared/organization/repositories'
import { userRepository } from '@/shared/user/repositories'
import { AppError } from '@/utils/errors'

import type {
  AddMemberBodySchemaType,
  CreateInvitationBodySchemaType,
  CreateOrganizationSchemaType,
  UpdateMemberRoleBodySchemaType,
  UpdateOrganizationSchemaType,
} from '../schemas'

/**
 * organizations featureのユースケースを提供するサービス。
 * ロール要求（ADMIN以上 / OWNERのみ）の判定もここで行う。
 */
export const organizationsService = {
  /**
   * 組織を作成する。作成者はOWNERとして登録される。
   */
  create: async (userId: number, input: CreateOrganizationSchemaType): Promise<OrganizationResponse> => {
    const organization = await organizationRepository.createWithOwner(input.name, userId)
    return toOrganizationResponse(organization)
  },

  /**
   * 認証済みユーザーが所属する組織の一覧を返す。
   */
  listMine: async (userId: number): Promise<OrganizationResponse[]> => {
    const organizations = await organizationRepository.findByUserId(userId)
    return organizations.map(toOrganizationResponse)
  },

  /**
   * 指定IDの組織情報を返す（メンバーであることはミドルウェアで確認済み）。
   */
  getById: async (organizationId: number): Promise<OrganizationResponse> => {
    const organization = await organizationRepository.findById(organizationId)
    if (!organization) {
      throw new AppError(404, '組織が見つかりません')
    }
    return toOrganizationResponse(organization)
  },

  /**
   * 組織を更新する。ADMIN以上のロールが必要。
   */
  update: async (organizationId: number, input: UpdateOrganizationSchemaType, role: Role): Promise<OrganizationResponse> => {
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
   * 組織のメンバー一覧を返す。MEMBER以上であれば閲覧可（ミドルウェアで確認済み）。
   */
  listMembers: async (organizationId: number): Promise<MemberResponse[]> => {
    const memberships = await membershipRepository.findAllByOrganization(organizationId)
    return memberships.map(toMemberResponse)
  },

  /**
   * メンバーを追加する。
   * OWNERはMEMBER/ADMINを追加可。ADMINはMEMBERのみ追加可。MEMBERは操作不可。
   */
  addMember: async (organizationId: number, operatorRole: Role, input: AddMemberBodySchemaType): Promise<MemberResponse> => {
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
   * メンバーのロールを変更する。
   * OWNERはADMIN/MEMBERへ変更可。ADMINはMEMBERのみ操作可でADMINへの昇格不可。MEMBERは操作不可。
   * 対象がOWNERの場合は操作不可（OWNERは自身に対しても含む）。
   */
  updateMemberRole: async (
    organizationId: number,
    membershipId: number,
    operatorRole: Role,
    input: UpdateMemberRoleBodySchemaType,
  ): Promise<MemberResponse> => {
    if (input.role === 'OWNER') {
      throw new AppError(422, 'OWNERへの変更はできません')
    }
    if (operatorRole === 'MEMBER') {
      throw new AppError(403, 'この操作には管理者以上の権限が必要です')
    }
    const target = await membershipRepository.findById(membershipId)
    if (!target || target.organizationId !== organizationId) {
      throw new AppError(404, 'メンバーが見つかりません')
    }
    if (target.role === 'OWNER') {
      throw new AppError(409, 'OWNERのロールは変更できません')
    }
    if (operatorRole === 'ADMIN' && target.role === 'ADMIN') {
      throw new AppError(403, 'ADMINは他のADMINを操作できません')
    }
    if (operatorRole === 'ADMIN' && input.role === 'ADMIN') {
      throw new AppError(403, 'ADMINはADMINへの昇格を実行できません')
    }
    const updated = await membershipRepository.updateRole(membershipId, input.role)
    if (!updated) {
      throw new AppError(404, 'メンバーが見つかりません')
    }
    return toMemberResponse(updated)
  },

  /**
   * メンバーを削除する。
   * OWNERはADMIN/MEMBERを削除可。ADMINはMEMBERのみ削除可。MEMBERは操作不可。
   * 対象がOWNERの場合は操作不可（OWNERは自身に対しても含む）。
   */
  removeMember: async (organizationId: number, membershipId: number, operatorRole: Role): Promise<void> => {
    if (operatorRole === 'MEMBER') {
      throw new AppError(403, 'この操作には管理者以上の権限が必要です')
    }
    const target = await membershipRepository.findById(membershipId)
    if (!target || target.organizationId !== organizationId) {
      throw new AppError(404, 'メンバーが見つかりません')
    }
    if (target.role === 'OWNER') {
      throw new AppError(409, 'OWNERは削除できません')
    }
    if (operatorRole === 'ADMIN' && target.role === 'ADMIN') {
      throw new AppError(403, 'ADMINは他のADMINを削除できません')
    }
    const deleted = await membershipRepository.deleteById(membershipId)
    if (!deleted) {
      throw new AppError(404, 'メンバーが見つかりません')
    }
  },

  /**
   * 招待を作成する。
   * OWNERはADMIN/MEMBERを招待可。ADMINはMEMBERのみ招待可。MEMBERは操作不可。
   * 既にPENDINGの招待がある場合、または対象メールが既にメンバーの場合は409。
   */
  createInvitation: async (organizationId: number, operatorRole: Role, input: CreateInvitationBodySchemaType): Promise<InvitationResponse> => {
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
      throw new AppError(409, 'このメールアドレスへの招待は既に送信済みです')
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
    const invitation = await invitationRepository.create(organizationId, input.email, input.role, token, expiresAt)
    return toInvitationResponse(invitation)
  },

  /**
   * 招待一覧を返す。OWNER/ADMINのみ閲覧可。デフォルトはPENDINGのみ。
   */
  listInvitations: async (organizationId: number, operatorRole: Role): Promise<InvitationResponse[]> => {
    if (operatorRole === 'MEMBER') {
      throw new AppError(403, 'この操作には管理者以上の権限が必要です')
    }
    const invitations = await invitationRepository.findAllByOrganization(organizationId)
    return invitations.map(toInvitationResponse)
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
    await invitationRepository.cancel(invitationId)
  },
}
