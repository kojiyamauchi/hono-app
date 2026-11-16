import type { Context } from 'hono'

import type { Role } from '@/shared/membership/entities'

import type { BodySchemaType } from '../schemas/transferOwnership'
import { transferOwnershipService } from '../services/transferOwnership'

/**
 * organizations/transfer-ownership のコントローラ。
 */
export const transferOwnershipController = {
  /**
   * 組織の所有権を既存メンバーへ移譲する。204を返す。
   */
  execute: async (c: Context, organizationId: number, currentOwnerUserId: number, operatorRole: Role, input: BodySchemaType): Promise<Response> => {
    await transferOwnershipService.execute(organizationId, currentOwnerUserId, operatorRole, input.membershipId)
    return c.body(null, 204)
  },
}
