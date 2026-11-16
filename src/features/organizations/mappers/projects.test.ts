import { describe, expect, test } from 'bun:test'

import { itemDto as projectDto, listDto as projectListDto } from '../dtos/projects'
import type { Project } from '../entities/projects'
import { decodeCursor, encodeCursor, toListResponse, toResponse } from './projects'

const toBase64Url = (value: string): string => Buffer.from(value, 'utf8').toString('base64url')

const validPayload = { kind: 'projects', version: 1, organizationId: 1, createdAt: '2026-01-01T00:00:00.000Z', id: 3 }

const project: Project = {
  id: 5,
  organizationId: 2,
  name: 'Alpha',
  description: 'desc',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T03:04:05.678Z'),
}

describe('encodeCursor / decodeCursor', () => {
  test('encodeした境界値をdecodeで元の値へ戻せる', () => {
    const boundary = { organizationId: 7, createdAt: new Date('2026-03-04T05:06:07.890Z'), id: 42 }

    const decoded = decodeCursor(encodeCursor(boundary))

    expect(decoded).toEqual(boundary)
    expect(decoded?.createdAt).toBeInstanceOf(Date)
  })

  test('kindとversionを含むbase64urlを発行する', () => {
    const cursor = encodeCursor({ organizationId: 1, createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 3 })

    expect(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))).toEqual(validPayload)
  })

  test('正規のペイロードをdecodeできる', () => {
    expect(decodeCursor(toBase64Url(JSON.stringify(validPayload)))).toEqual({
      organizationId: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      id: 3,
    })
  })

  test.each([
    ['base64urlではない文字列', '!!!'],
    ['JSONではない', toBase64Url('not-json')],
    ['kindなし（メンバー一覧のカーソル）', toBase64Url(JSON.stringify({ version: 1, organizationId: 1, createdAt: '2026-01-01T00:00:00.000Z', id: 3 }))],
    ['別kind（監査ログのカーソル）', toBase64Url(JSON.stringify({ ...validPayload, kind: 'auditLogs' }))],
    ['未対応version', toBase64Url(JSON.stringify({ ...validPayload, version: 2 }))],
    ['IDが0', toBase64Url(JSON.stringify({ ...validPayload, id: 0 }))],
    ['IDが範囲外', toBase64Url(JSON.stringify({ ...validPayload, id: 2147483648 }))],
    ['日時が不正', toBase64Url(JSON.stringify({ ...validPayload, createdAt: 'yesterday' }))],
    ['0年の日時', toBase64Url(JSON.stringify({ ...validPayload, createdAt: '0000-01-01T00:00:00.000Z' }))],
    ['末尾に不正な文字を付加', `${toBase64Url(JSON.stringify(validPayload))}!`],
    ['パディング付き', `${toBase64Url(JSON.stringify(validPayload))}=`],
  ])('不正なカーソルはnullを返す: %s', (_name, raw) => {
    expect(decodeCursor(raw)).toBeNull()
  })
})

describe('toResponse', () => {
  test('6項目のDTOへ変換し、日時をISO 8601文字列にする', () => {
    const dto = toResponse(project)

    expect(dto).toEqual({
      id: 5,
      organizationId: 2,
      name: 'Alpha',
      description: 'desc',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T03:04:05.678Z',
    })
    expect(projectDto.safeParse(dto).success).toBe(true)
  })

  test('descriptionがnullでもキーを返し、空文字はそのまま返す', () => {
    const nullDto = toResponse({ ...project, description: null })
    expect(nullDto).toHaveProperty('description', null)
    expect(projectDto.safeParse(nullDto).success).toBe(true)

    expect(toResponse({ ...project, description: '' }).description).toBe('')
  })
})

describe('toListResponse', () => {
  test('itemsとnextCursorを返し、DTOの定義と整合する', () => {
    const response = toListResponse([project], 'next')

    expect(response.items).toHaveLength(1)
    expect(response.nextCursor).toBe('next')
    expect(projectListDto.safeParse(response).success).toBe(true)
  })

  test('0件・最終ページではnextCursorをnullで返す', () => {
    const response = toListResponse([], null)

    expect(response).toEqual({ items: [], nextCursor: null })
    expect(projectListDto.safeParse(response).success).toBe(true)
  })
})
