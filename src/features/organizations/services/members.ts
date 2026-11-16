import type { MemberDtoType } from '@/shared/membership/dtos'
import type { Role } from '@/shared/membership/entities'
import { toMemberResponse } from '@/shared/membership/mappers'
import { type MembershipPageBoundary, membershipRepository } from '@/shared/membership/repositories'
import { userRepository } from '@/shared/user/repositories'
import { AppError } from '@/utils/errors'

import type { ListDtoType } from '../dtos/members'
import { decodeMemberListCursor, encodeMemberListCursor, toMemberListResponse } from '../mappers/members'
import { leaveOrganizationResults, memberRemovalResults, memberRoleChangeResults, membersRepository } from '../repositories/members'
import type { AddBodySchemaType, UpdateRoleBodySchemaType } from '../schemas/members'

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
 * 組織のメンバー操作のユースケースを提供するサービス。
 */
export const membersService = {
  /**
   * 組織のメンバー一覧をカーソル式で1ページ分返す。MEMBER以上であれば閲覧可（ミドルウェアで確認済み）。
   * カーソルは境界値としてのみ使い、基準行が削除されても続きが取得できる（行の存在に依存しない）。
   * 次ページの有無は `limit + 1` 件の取得で判定し、レスポンスのitemsは `limit` 件以下にする。
   * 形式が不正なカーソルと、別組織で発行されたカーソルはどちらも400とする。
   */
  list: async (organizationId: number, limit: number, cursor?: string): Promise<ListDtoType> => {
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
   * メンバーを追加する。
   * OWNERはMEMBER/ADMINを追加可。ADMINはMEMBERのみ追加可。MEMBERは操作不可。
   */
  add: async (organizationId: number, operatorRole: Role, input: AddBodySchemaType): Promise<MemberDtoType> => {
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
  updateRole: async (
    organizationId: number,
    membershipId: number,
    actorUserId: number,
    operatorRole: Role,
    input: UpdateRoleBodySchemaType,
  ): Promise<MemberDtoType> => {
    if (input.role === 'OWNER') {
      throw new AppError(422, 'OWNERへの変更はできません')
    }
    if (operatorRole === 'MEMBER') {
      throw new AppError(403, 'この操作には管理者以上の権限が必要です')
    }

    const result = await membersRepository.changeRole<AppError>(
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
  remove: async (organizationId: number, membershipId: number, actorUserId: number): Promise<void> => {
    const result = await membersRepository.remove<AppError>({ organizationId, targetMembershipId: membershipId, actorUserId }, (locked) =>
      authorizeMemberRemoval(locked.operatorRole, locked.targetRole),
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
   * 認証ユーザー自身を組織から脱退させる。OWNERは先に所有権を移譲する必要がある。
   */
  leave: async (organizationId: number, userId: number): Promise<void> => {
    const result = await membersRepository.leave(organizationId, userId)
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
}
