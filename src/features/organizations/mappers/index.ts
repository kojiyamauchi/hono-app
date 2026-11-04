import type { Membership } from '@/shared/membership/entities'
import { toMemberResponse } from '@/shared/membership/mappers'
import type { Organization } from '@/shared/organization/entities'
import { toOrganizationResponse } from '@/shared/organization/mappers'

import type { MemberListDtoType, OrganizationListDtoType } from '../dtos'
import { MEMBER_LIST_CURSOR_VERSION, memberListCursorPayloadSchema } from '../schemas'

/**
 * メンバー一覧カーソルが指す境界値（この行より後ろを取得する）。
 * `organizationId` はカーソルを発行した組織で、別組織への使い回しを検出するために含める。
 */
export type MemberListCursorBoundary = { organizationId: number; createdAt: Date; id: number }

/**
 * 境界値をメンバー一覧用の不透明なカーソル文字列へ変換する（JSONをbase64urlで包む）。
 * 署名・暗号化は行わない。デコードすれば内容を読めて改変もできる前提のため、機密情報を含めないこと。
 */
export const encodeMemberListCursor = (boundary: MemberListCursorBoundary): string => {
  const json = JSON.stringify({
    version: MEMBER_LIST_CURSOR_VERSION,
    organizationId: boundary.organizationId,
    createdAt: boundary.createdAt.toISOString(),
    id: boundary.id,
  })
  return Buffer.from(json, 'utf8').toString('base64url')
}

/**
 * メンバー一覧用のカーソル文字列を境界値へ戻す。
 * 形式・値が不正なら `null` を返し、呼び出し側で400へ変換する。
 * 対象組織の一致はservice層が認可済みのorganizationIdと突き合わせて確認する。
 */
export const decodeMemberListCursor = (raw: string): MemberListCursorBoundary | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
  } catch {
    return null
  }

  const result = memberListCursorPayloadSchema.safeParse(parsed)
  if (!result.success) {
    return null
  }

  return {
    organizationId: result.data.organizationId,
    createdAt: new Date(result.data.createdAt),
    id: result.data.id,
  }
}

/**
 * メンバーのページをカーソル式ページネーションの応答DTOへ変換する。
 * `nextCursor` が `null` なら後続のページは存在しない。
 */
export const toMemberListResponse = (memberships: Membership[], nextCursor: string | null): MemberListDtoType => {
  return {
    items: memberships.map(toMemberResponse),
    nextCursor,
  }
}

/**
 * 組織のページをオフセット式ページネーションの応答DTOへ変換する。
 */
export const toOrganizationListResponse = (organizations: Organization[], limit: number, offset: number, hasNext: boolean): OrganizationListDtoType => {
  return {
    items: organizations.map(toOrganizationResponse),
    limit,
    offset,
    hasNext,
  }
}
