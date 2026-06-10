import type { Role } from '@/shared/membership/entities'
import type { OrganizationResponse } from '@/shared/organization/dtos'
import { toOrganizationResponse } from '@/shared/organization/mappers'
import { organizationRepository } from '@/shared/organization/repositories'
import { AppError } from '@/utils/errors'

import type { CreateOrganizationInput, UpdateOrganizationInput } from '../schemas'

/**
 * organizations featureのユースケースを提供するサービス。
 * ロール要求（ADMIN以上 / OWNERのみ）の判定もここで行う。
 */
export const organizationsService = {
  /**
   * 組織を作成する。作成者はOWNERとして登録される。
   */
  create: async (userId: number, input: CreateOrganizationInput): Promise<OrganizationResponse> => {
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
  update: async (organizationId: number, input: UpdateOrganizationInput, role: Role): Promise<OrganizationResponse> => {
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
}
