import { describe, expect, test } from 'bun:test'

import { itemDto as auditLogDto, listDto as auditLogListDto } from '../dtos/auditLogs'
import type { AuditLog } from '../entities/auditLogs'
import { decodeCursor, encodeCursor, toListResponse, toResponse } from './auditLogs'
import { decodeCursor as decodeMemberCursor, encodeCursor as encodeMemberCursor } from './members'

const toBase64Url = (value: string): string => Buffer.from(value, 'utf8').toString('base64url')

describe('encodeCursor / decodeCursor', () => {
  const validAuditPayload = { kind: 'auditLogs', version: 1, organizationId: 1, createdAt: '2026-01-01T00:00:00.000Z', id: 3 }

  test('encodeした境界値をdecodeで元の値へ戻せ、kindを含む', () => {
    const boundary = { organizationId: 7, createdAt: new Date('2026-03-04T05:06:07.890Z'), id: 42 }
    const cursor = encodeCursor(boundary)

    expect(decodeCursor(cursor)).toEqual(boundary)
    expect(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))).toMatchObject({ kind: 'auditLogs', version: 1 })
  })

  test('base64urlではない文字列・JSONではない文字列・形が一致しない値はnullを返す', () => {
    expect(decodeCursor('!!! not base64url !!!')).toBeNull()
    expect(decodeCursor(toBase64Url('not json'))).toBeNull()
    expect(decodeCursor(toBase64Url(JSON.stringify({ foo: 'bar' })))).toBeNull()
    expect(decodeCursor(toBase64Url('null'))).toBeNull()
  })

  test('kindを持たないメンバー一覧のカーソルはnullを返す', () => {
    const memberCursor = encodeMemberCursor({ organizationId: 1, createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 3 })

    expect(decodeCursor(memberCursor)).toBeNull()
  })

  test('versionが一致しない値はnullを返す', () => {
    expect(decodeCursor(toBase64Url(JSON.stringify({ ...validAuditPayload, version: 2 })))).toBeNull()
  })

  test('PostgreSQLで扱えない0年の日時はnullを返す', () => {
    expect(decodeCursor(toBase64Url(JSON.stringify({ ...validAuditPayload, createdAt: '0000-01-01T00:00:00.000Z' })))).toBeNull()
  })

  test('正しいペイロードはデコードできる', () => {
    expect(decodeCursor(toBase64Url(JSON.stringify(validAuditPayload)))).toEqual({
      organizationId: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      id: 3,
    })
  })

  test('メンバー一覧のデコードは監査ログのカーソルを従来どおり受理する（逆方向の拒否は範囲外で、既存仕様は変更しない）', () => {
    const auditCursor = encodeCursor({ organizationId: 1, createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 3 })

    expect(decodeMemberCursor(auditCursor)).not.toBeNull()
  })

  // `Buffer.from(raw, 'base64url')` は不正な文字を黙って無視するため、改変されたカーソルも復元できてしまう。
  // 発行時と同じ正規のbase64url文字列以外は、改変されたカーソルとしてnullにする。
  describe('正規のbase64url形式ではないカーソル', () => {
    const boundary = { organizationId: 1, createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 3 }
    const validCursor = encodeCursor(boundary)

    test('発行したカーソルはそのまま復元できる（比較用の前提）', () => {
      expect(decodeCursor(validCursor)).toEqual(boundary)
    })

    test.each(['!', '!!!', '*', ' ', '@'])('末尾に不正な文字（%j）を付加したものはnullを返す', (suffix) => {
      expect(decodeCursor(`${validCursor}${suffix}`)).toBeNull()
    })

    test('途中に不正な文字を挿入したものはnullを返す', () => {
      expect(decodeCursor(`${validCursor.slice(0, 10)}!${validCursor.slice(10)}`)).toBeNull()
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
      expect(decodeCursor(urlSafeBase64)).toEqual(boundary)
      expect(decodeCursor(standardBase64.replace(/=+$/, ''))).toBeNull()
    })

    test('=パディングを付けたものはnullを返す', () => {
      const json = JSON.stringify({ kind: 'auditLogs', version: 1, organizationId: 1, createdAt: '2026-01-01T00:00:00.000Z', id: 3, filler: 'a' })
      const padded = Buffer.from(json, 'utf8').toString('base64')

      expect(padded.endsWith('=')).toBe(true)
      expect(decodeCursor(padded.replace(/=+$/, ''))).toEqual(boundary)
      expect(decodeCursor(padded)).toBeNull()
    })
  })

  test('メンバー一覧のデコードは従来どおり、末尾に不正な文字を付加したカーソルも受理する（既存仕様は変更しない）', () => {
    const memberCursor = encodeMemberCursor({ organizationId: 1, createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 3 })

    expect(decodeMemberCursor(`${memberCursor}!`)).not.toBeNull()
  })
})

describe('toResponse / toListResponse', () => {
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
    const result = toResponse(auditLog)

    expect(result).toEqual({ ...auditLog, createdAt: '2026-01-01T00:00:00.000Z' })
    expect(auditLogDto.safeParse(result).success).toBe(true)
  })

  test('OWNERSHIP_TRANSFERREDの監査ログも同じ形でauditLogDto schemaに通る', () => {
    const transferred: AuditLog = { ...auditLog, id: 2, action: 'OWNERSHIP_TRANSFERRED', previousRole: 'ADMIN', newRole: 'OWNER' }
    const result = toResponse(transferred)

    expect(result).toEqual({ ...transferred, createdAt: '2026-01-01T00:00:00.000Z' })
    expect(auditLogDto.safeParse(result).success).toBe(true)
  })

  test('MEMBER_REMOVEDの監査ログはnewRoleがnullのままキーを残し、auditLogDto schemaに通る', () => {
    const removed: AuditLog = { ...auditLog, id: 3, action: 'MEMBER_REMOVED', previousRole: 'ADMIN', newRole: null }

    const result = toResponse(removed)

    expect(result).toEqual({ ...removed, createdAt: '2026-01-01T00:00:00.000Z' })
    expect(result).toHaveProperty('newRole', null)
    expect(auditLogDto.safeParse(result).success).toBe(true)
  })

  describe('プロジェクトイベント', () => {
    const common = { organizationId: 2, actorUserId: 10, projectId: 42, createdAt: new Date('2026-01-01T00:00:00.000Z') }
    const createdAt = '2026-01-01T00:00:00.000Z'

    test('PROJECT_CREATEDはbeforeをnull、afterに作成内容を返し、メンバー向けキーとprojectBefore/Afterを返さない', () => {
      const created: AuditLog = { ...common, id: 5, action: 'PROJECT_CREATED', projectBefore: null, projectAfter: { name: 'Alpha', description: null } }

      const result = toResponse(created)

      expect(result).toEqual({
        id: 5,
        organizationId: 2,
        action: 'PROJECT_CREATED',
        actorUserId: 10,
        createdAt,
        projectId: 42,
        before: null,
        after: { name: 'Alpha', description: null },
      })
      expect(auditLogDto.safeParse(result).success).toBe(true)
    })

    test('PROJECT_UPDATEDはbefore/afterの両方を返し、説明のnullと空文字を区別する', () => {
      const updated: AuditLog = {
        ...common,
        id: 6,
        action: 'PROJECT_UPDATED',
        projectBefore: { name: '旧名称', description: null },
        projectAfter: { name: '新名称', description: '' },
      }

      const result = toResponse(updated)

      expect(result).toEqual({
        id: 6,
        organizationId: 2,
        action: 'PROJECT_UPDATED',
        actorUserId: 10,
        createdAt,
        projectId: 42,
        before: { name: '旧名称', description: null },
        after: { name: '新名称', description: '' },
      })
      expect(auditLogDto.safeParse(result).success).toBe(true)
    })

    test('PROJECT_DELETEDはbeforeに削除直前の内容、afterをnullのままキーを残す', () => {
      const deleted: AuditLog = { ...common, id: 7, action: 'PROJECT_DELETED', projectBefore: { name: 'Alpha', description: 'desc' }, projectAfter: null }

      const result = toResponse(deleted)

      expect(result).toEqual({
        id: 7,
        organizationId: 2,
        action: 'PROJECT_DELETED',
        actorUserId: 10,
        createdAt,
        projectId: 42,
        before: { name: 'Alpha', description: 'desc' },
        after: null,
      })
      expect(result).toHaveProperty('after', null)
      expect(auditLogDto.safeParse(result).success).toBe(true)
    })

    test('入力に余分なキーがあってもスナップショットはnameとdescriptionの2キーだけを返す', () => {
      const created = {
        ...common,
        id: 8,
        action: 'PROJECT_CREATED',
        projectBefore: null,
        projectAfter: { name: 'Alpha', description: null, updatedAt: 'x' },
      } as AuditLog

      const result = toResponse(created)

      expect(Object.keys((result as { after: object }).after)).toEqual(['name', 'description'])
    })

    test('2,000文字超の説明や100文字超の名前も切り詰めずに返す（DTOに文字数制約はない）', () => {
      const longName = 'あ'.repeat(150)
      const longDescription = 'a'.repeat(2500)
      const deleted: AuditLog = {
        ...common,
        id: 9,
        action: 'PROJECT_DELETED',
        projectBefore: { name: longName, description: longDescription },
        projectAfter: null,
      }

      const result = toResponse(deleted)

      expect(result).toMatchObject({ before: { name: longName, description: longDescription } })
      expect(auditLogDto.safeParse(result).success).toBe(true)
    })

    test('未知のactionは暗黙に変換せず例外にする', () => {
      const unknown = { ...common, id: 10, action: 'PROJECT_ARCHIVED' } as unknown as AuditLog

      expect(() => toResponse(unknown)).toThrow()
    })

    test('既存3イベントの応答にプロジェクト向けキーが含まれない', () => {
      const member: AuditLog = {
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

      const keys = Object.keys(toResponse(member)).sort()

      expect(keys).toEqual(['action', 'actorUserId', 'createdAt', 'id', 'newRole', 'organizationId', 'previousRole', 'targetMembershipId', 'targetUserId'])
    })

    test('6イベント混在のリストがauditLogListDto schemaに通る', () => {
      const logs: AuditLog[] = [
        { ...common, id: 3, action: 'PROJECT_DELETED', projectBefore: { name: 'A', description: null }, projectAfter: null },
        { ...common, id: 2, action: 'PROJECT_UPDATED', projectBefore: { name: 'A', description: null }, projectAfter: { name: 'B', description: null } },
        { ...common, id: 1, action: 'PROJECT_CREATED', projectBefore: null, projectAfter: { name: 'A', description: null } },
      ]

      expect(auditLogListDto.safeParse(toListResponse(logs, null)).success).toBe(true)
    })
  })

  test('監査ログとnextCursorをレスポンス用に変換し、auditLogListDto schemaに通る', () => {
    const result = toListResponse([auditLog], 'cursor')

    expect(result.items).toHaveLength(1)
    expect(result.nextCursor).toBe('cursor')
    expect(auditLogListDto.safeParse(result).success).toBe(true)
  })

  test('後続ページがない場合はnextCursorをnullのまま返す', () => {
    const result = toListResponse([], null)

    expect(result).toEqual({ items: [], nextCursor: null })
    expect(auditLogListDto.safeParse(result).success).toBe(true)
  })
})
