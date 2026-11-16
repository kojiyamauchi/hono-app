import type { Role } from '@/shared/membership/entities'
import { AppError } from '@/utils/errors'

import { ownershipTransferResults, transferOwnershipRepository } from '../repositories/transferOwnership'

/**
 * 組織の所有権移譲のユースケースを提供するサービス。
 */
export const transferOwnershipService = {
  /**
   * 現在のOWNERから同じ組織のADMINまたはMEMBERへ所有権を移譲する。
   */
  execute: async (organizationId: number, currentOwnerUserId: number, operatorRole: Role, targetMembershipId: number): Promise<void> => {
    if (operatorRole !== 'OWNER') {
      throw new AppError(403, 'この操作にはオーナー権限が必要です')
    }

    const result = await transferOwnershipRepository.execute(organizationId, currentOwnerUserId, targetMembershipId)
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
}
