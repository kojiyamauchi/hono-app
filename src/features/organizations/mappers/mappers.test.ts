import { describe, expect, test } from 'bun:test'

import type { Membership } from '@/shared/membership/entities'
import type { Organization } from '@/shared/organization/entities'

import { auditLogDto, auditLogListDto, memberListDto, organizationListDto } from '../dtos'
import type { AuditLog } from '../entities'
import {
  decodeAuditLogCursor,
  decodeMemberListCursor,
  encodeAuditLogCursor,
  encodeMemberListCursor,
  toAuditLogListResponse,
  toAuditLogResponse,
  toMemberListResponse,
  toOrganizationListResponse,
} from '.'

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

  // z.iso.datetime() は0年を許容するが、PostgreSQLへバインドすると 22008 で500になるため
  // デコード時点で弾き、400へ落とす（カーソルは改変できる入力である前提）。
  test('PostgreSQLで扱えない0年の日時はnullを返す', () => {
    expect(decodeMemberListCursor(toBase64Url(JSON.stringify({ ...validPayload, createdAt: '0000-01-01T00:00:00.000Z' })))).toBeNull()
  })

  test('1年以降の日時は受け付ける', () => {
    expect(decodeMemberListCursor(toBase64Url(JSON.stringify({ ...validPayload, createdAt: '0001-01-01T00:00:00.000Z' })))).not.toBeNull()
  })

  test('正しいペイロードはデコードできる', () => {
    expect(decodeMemberListCursor(toBase64Url(JSON.stringify(validPayload)))).toEqual({
      organizationId: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      id: 3,
    })
  })
})

describe('encodeAuditLogCursor / decodeAuditLogCursor', () => {
  const validAuditPayload = { kind: 'auditLogs', version: 1, organizationId: 1, createdAt: '2026-01-01T00:00:00.000Z', id: 3 }

  test('encodeした境界値をdecodeで元の値へ戻せ、kindを含む', () => {
    const boundary = { organizationId: 7, createdAt: new Date('2026-03-04T05:06:07.890Z'), id: 42 }
    const cursor = encodeAuditLogCursor(boundary)

    expect(decodeAuditLogCursor(cursor)).toEqual(boundary)
    expect(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))).toMatchObject({ kind: 'auditLogs', version: 1 })
  })

  test('base64urlではない文字列・JSONではない文字列・形が一致しない値はnullを返す', () => {
    expect(decodeAuditLogCursor('!!! not base64url !!!')).toBeNull()
    expect(decodeAuditLogCursor(toBase64Url('not json'))).toBeNull()
    expect(decodeAuditLogCursor(toBase64Url(JSON.stringify({ foo: 'bar' })))).toBeNull()
    expect(decodeAuditLogCursor(toBase64Url('null'))).toBeNull()
  })

  test('kindを持たないメンバー一覧のカーソルはnullを返す', () => {
    const memberCursor = encodeMemberListCursor({ organizationId: 1, createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 3 })

    expect(decodeAuditLogCursor(memberCursor)).toBeNull()
  })

  test('versionが一致しない値はnullを返す', () => {
    expect(decodeAuditLogCursor(toBase64Url(JSON.stringify({ ...validAuditPayload, version: 2 })))).toBeNull()
  })

  test('PostgreSQLで扱えない0年の日時はnullを返す', () => {
    expect(decodeAuditLogCursor(toBase64Url(JSON.stringify({ ...validAuditPayload, createdAt: '0000-01-01T00:00:00.000Z' })))).toBeNull()
  })

  test('正しいペイロードはデコードできる', () => {
    expect(decodeAuditLogCursor(toBase64Url(JSON.stringify(validAuditPayload)))).toEqual({
      organizationId: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      id: 3,
    })
  })

  test('メンバー一覧のデコードは監査ログのカーソルを従来どおり受理する（逆方向の拒否は範囲外で、既存仕様は変更しない）', () => {
    const auditCursor = encodeAuditLogCursor({ organizationId: 1, createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 3 })

    expect(decodeMemberListCursor(auditCursor)).not.toBeNull()
  })

  // `Buffer.from(raw, 'base64url')` は不正な文字を黙って無視するため、改変されたカーソルも復元できてしまう。
  // 発行時と同じ正規のbase64url文字列以外は、改変されたカーソルとしてnullにする。
  describe('正規のbase64url形式ではないカーソル', () => {
    const boundary = { organizationId: 1, createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 3 }
    const validCursor = encodeAuditLogCursor(boundary)

    test('発行したカーソルはそのまま復元できる（比較用の前提）', () => {
      expect(decodeAuditLogCursor(validCursor)).toEqual(boundary)
    })

    test.each(['!', '!!!', '*', ' ', '@'])('末尾に不正な文字（%j）を付加したものはnullを返す', (suffix) => {
      expect(decodeAuditLogCursor(`${validCursor}${suffix}`)).toBeNull()
    })

    test('途中に不正な文字を挿入したものはnullを返す', () => {
      expect(decodeAuditLogCursor(`${validCursor.slice(0, 10)}!${validCursor.slice(10)}`)).toBeNull()
    })

    test.each([
      ['+', '>>>>>>'],
      ['/', '??????'],
    ])('URLセーフではない文字（%s）を含む標準base64形式のものはnullを返す', (character, filler) => {
      // 無視される追加プロパティに、標準base64でのみ `+` や `/` へ符号化される値を入れて、URLセーフな形と標準形を作る
      const json = JSON.stringify({ kind: 'auditLogs', version: 1, organizationId: 1, createdAt: '2026-01-01T00:00:00.000Z', id: 3, filler })
      const standardBase64 = Buffer.from(json, 'utf8').toString('base64')
      const urlSafeBase64 = Buffer.from(json, 'utf8').toString('base64url')

      expect(standardBase64).toContain(character)
      expect(decodeAuditLogCursor(urlSafeBase64)).toEqual(boundary)
      expect(decodeAuditLogCursor(standardBase64.replace(/=+$/, ''))).toBeNull()
    })

    test('=パディングを付けたものはnullを返す', () => {
      const json = JSON.stringify({ kind: 'auditLogs', version: 1, organizationId: 1, createdAt: '2026-01-01T00:00:00.000Z', id: 3, filler: 'a' })
      const padded = Buffer.from(json, 'utf8').toString('base64')

      expect(padded.endsWith('=')).toBe(true)
      expect(decodeAuditLogCursor(padded.replace(/=+$/, ''))).toEqual(boundary)
      expect(decodeAuditLogCursor(padded)).toBeNull()
    })
  })

  test('メンバー一覧のデコードは従来どおり、末尾に不正な文字を付加したカーソルも受理する（既存仕様は変更しない）', () => {
    const memberCursor = encodeMemberListCursor({ organizationId: 1, createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 3 })

    expect(decodeMemberListCursor(`${memberCursor}!`)).not.toBeNull()
  })
})

describe('toAuditLogResponse / toAuditLogListResponse', () => {
  const auditLog: AuditLog = {
    id: 1,
    organizationId: 2,
    action: 'MEMBER_ROLE_CHANGED',
    actorUserId: 10,
    targetUserId: 11,
    targetMembershipId: 12,
    previousRole: 'MEMBER',
    newRole: 'ADMIN',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  }

  test('監査ログをレスポンス用に変換し、createdAtはISO 8601文字列でauditLogDto schemaに通る', () => {
    const result = toAuditLogResponse(auditLog)

    expect(result).toEqual({ ...auditLog, createdAt: '2026-01-01T00:00:00.000Z' })
    expect(auditLogDto.safeParse(result).success).toBe(true)
  })

  test('監査ログとnextCursorをレスポンス用に変換し、auditLogListDto schemaに通る', () => {
    const result = toAuditLogListResponse([auditLog], 'cursor')

    expect(result.items).toHaveLength(1)
    expect(result.nextCursor).toBe('cursor')
    expect(auditLogListDto.safeParse(result).success).toBe(true)
  })

  test('後続ページがない場合はnextCursorをnullのまま返す', () => {
    const result = toAuditLogListResponse([], null)

    expect(result).toEqual({ items: [], nextCursor: null })
    expect(auditLogListDto.safeParse(result).success).toBe(true)
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
