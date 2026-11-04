import { describe, expect, test } from 'bun:test'

import type { Membership } from '@/shared/membership/entities'
import type { Organization } from '@/shared/organization/entities'

import { memberListDto, organizationListDto } from '../dtos'
import { decodeMemberListCursor, encodeMemberListCursor, toMemberListResponse, toOrganizationListResponse } from '.'

const toBase64Url = (value: string): string => Buffer.from(value, 'utf8').toString('base64url')

const validPayload = { version: 1, organizationId: 1, createdAt: '2026-01-01T00:00:00.000Z', id: 3 }

describe('encodeMemberListCursor / decodeMemberListCursor', () => {
  test('encodeした境界値をdecodeで元の値へ戻せる', () => {
    const boundary = { organizationId: 7, createdAt: new Date('2026-03-04T05:06:07.890Z'), id: 42 }

    const decoded = decodeMemberListCursor(encodeMemberListCursor(boundary))

    expect(decoded).toEqual(boundary)
    expect(decoded?.createdAt).toBeInstanceOf(Date)
  })

  test('base64urlではない文字列はnullを返す', () => {
    expect(decodeMemberListCursor('!!! not base64url !!!')).toBeNull()
  })

  test('base64urlだがJSONではない文字列はnullを返す', () => {
    expect(decodeMemberListCursor(toBase64Url('not json'))).toBeNull()
  })

  test('JSONだが形が一致しない値はnullを返す', () => {
    expect(decodeMemberListCursor(toBase64Url(JSON.stringify({ foo: 'bar' })))).toBeNull()
    expect(decodeMemberListCursor(toBase64Url(JSON.stringify([1, 2, 3])))).toBeNull()
    expect(decodeMemberListCursor(toBase64Url('null'))).toBeNull()
  })

  test('versionが一致しない値はnullを返す', () => {
    expect(decodeMemberListCursor(toBase64Url(JSON.stringify({ ...validPayload, version: 2 })))).toBeNull()
  })

  test('idが0以下の値はnullを返す', () => {
    expect(decodeMemberListCursor(toBase64Url(JSON.stringify({ ...validPayload, id: 0 })))).toBeNull()
  })

  test('正しいペイロードはデコードできる', () => {
    expect(decodeMemberListCursor(toBase64Url(JSON.stringify(validPayload)))).toEqual({
      organizationId: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      id: 3,
    })
  })
})

describe('toMemberListResponse', () => {
  const membership: Membership = {
    id: 1,
    userId: 10,
    organizationId: 2,
    role: 'MEMBER',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  }

  test('メンバーとnextCursorをレスポンス用に変換し、memberListDto schemaに通る', () => {
    const result = toMemberListResponse([membership], 'cursor')

    expect(result.items).toHaveLength(1)
    expect(result.nextCursor).toBe('cursor')
    expect(memberListDto.safeParse(result).success).toBe(true)
  })

  test('後続ページがない場合はnextCursorをnullのまま返す', () => {
    const result = toMemberListResponse([], null)

    expect(result).toEqual({ items: [], nextCursor: null })
    expect(memberListDto.safeParse(result).success).toBe(true)
  })
})

describe('toOrganizationListResponse', () => {
  const organization: Organization = {
    id: 1,
    name: 'Acme',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  }

  test('組織とページ情報をレスポンス用に変換し、organizationListDto schemaに通る', () => {
    const result = toOrganizationListResponse([organization], 20, 40, true)

    expect(result.items).toHaveLength(1)
    expect(result).toMatchObject({ limit: 20, offset: 40, hasNext: true })
    expect(organizationListDto.safeParse(result).success).toBe(true)
  })
})
