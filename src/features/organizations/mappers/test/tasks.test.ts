import { describe, expect, test } from 'bun:test'

import { itemDto as taskDto, listDto as taskListDto } from '../../dtos/tasks'
import type { Task } from '../../entities/tasks'
import { decodeTaskCursor, encodeTaskCursor, toTaskListResponse, toTaskResponse } from '../tasks'

const toBase64Url = (value: string): string => Buffer.from(value, 'utf8').toString('base64url')

const validPayload = { kind: 'tasks', version: 1, organizationId: 1, projectId: 2, status: null, createdAt: '2026-01-01T00:00:00.000Z', id: 3 }

const task: Task = {
  id: 5,
  projectId: 2,
  title: 'Write docs',
  description: 'desc',
  status: 'IN_PROGRESS',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T03:04:05.678Z'),
}

describe('encodeTaskCursor / decodeTaskCursor', () => {
  test.each([null, 'TODO', 'IN_PROGRESS', 'DONE'] as const)('status %s の境界値をencodeしてdecodeで元の値へ戻せる', (status) => {
    const boundary = { organizationId: 7, projectId: 8, status, createdAt: new Date('2026-03-04T05:06:07.890Z'), id: 42 }

    const decoded = decodeTaskCursor(encodeTaskCursor(boundary))

    expect(decoded).toEqual(boundary)
    expect(decoded?.createdAt).toBeInstanceOf(Date)
  })

  test('kind・version・projectId・statusを含むbase64urlを発行する', () => {
    const cursor = encodeTaskCursor({ organizationId: 1, projectId: 2, status: null, createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 3 })

    expect(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))).toEqual(validPayload)
  })

  test.each([
    ['base64urlではない文字列', '!!!'],
    ['JSONではない', toBase64Url('not-json')],
    ['kindなし', toBase64Url(JSON.stringify({ ...validPayload, kind: undefined }))],
    ['別kind（プロジェクト一覧のカーソル）', toBase64Url(JSON.stringify({ ...validPayload, kind: 'projects' }))],
    ['未対応version', toBase64Url(JSON.stringify({ ...validPayload, version: 2 }))],
    ['projectIdなし', toBase64Url(JSON.stringify({ ...validPayload, projectId: undefined }))],
    ['statusなし', toBase64Url(JSON.stringify({ ...validPayload, status: undefined }))],
    ['statusが不正', toBase64Url(JSON.stringify({ ...validPayload, status: 'CLOSED' }))],
    ['IDが範囲外', toBase64Url(JSON.stringify({ ...validPayload, id: 2147483648 }))],
    ['日時が不正', toBase64Url(JSON.stringify({ ...validPayload, createdAt: 'yesterday' }))],
    ['末尾に不正な文字を付加', `${toBase64Url(JSON.stringify(validPayload))}!`],
    ['パディング付き', `${toBase64Url(JSON.stringify(validPayload))}=`],
  ])('不正なカーソルはnullを返す: %s', (_name, raw) => {
    expect(decodeTaskCursor(raw)).toBeNull()
  })
})

describe('toTaskResponse', () => {
  test('7項目のDTOへ変換し、日時をISO 8601文字列にする', () => {
    const dto = toTaskResponse(task)

    expect(dto).toEqual({
      id: 5,
      projectId: 2,
      title: 'Write docs',
      description: 'desc',
      status: 'IN_PROGRESS',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T03:04:05.678Z',
    })
    expect(Object.keys(dto)).toHaveLength(7)
    expect(taskDto.safeParse(dto).success).toBe(true)
  })

  test('descriptionがnullでもキーを返し、空文字はそのまま返す', () => {
    const nullDto = toTaskResponse({ ...task, description: null })
    expect(nullDto).toHaveProperty('description', null)
    expect(taskDto.safeParse(nullDto).success).toBe(true)

    expect(toTaskResponse({ ...task, description: '' }).description).toBe('')
  })

  test.each(['TODO', 'IN_PROGRESS', 'DONE'] as const)('状態 %s をDTOの定義と整合させて返す', (status) => {
    expect(taskDto.safeParse(toTaskResponse({ ...task, status })).success).toBe(true)
  })
})

describe('toTaskListResponse', () => {
  test('itemsとnextCursorを返し、DTOの定義と整合する', () => {
    const response = toTaskListResponse([task], 'next')

    expect(response.items).toHaveLength(1)
    expect(response.nextCursor).toBe('next')
    expect(taskListDto.safeParse(response).success).toBe(true)
  })

  test('0件・最終ページではnextCursorをnullで返す', () => {
    const response = toTaskListResponse([], null)

    expect(response).toEqual({ items: [], nextCursor: null })
    expect(taskListDto.safeParse(response).success).toBe(true)
  })
})
