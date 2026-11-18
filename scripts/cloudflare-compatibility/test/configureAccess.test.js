import { expect, test } from 'bun:test'

import { selectVerificationToken } from '../configureAccess.mjs'

/** 検証用サービストークンの公開メタデータ。 */
const token = (overrides = {}) => ({
  name: 'hono-app-dev-verification',
  id: '11111111-2222-3333-4444-555555555555',
  client_id: 'test-client.access',
  expires_at: '2026-12-01T00:00:00Z',
  enabled: true,
  ...overrides,
})

const now = Date.parse('2026-11-17T00:00:00Z')

test('指定したClient IDに対応する検証用トークンだけを選ぶ', () => {
  expect(selectVerificationToken([token({ name: 'other-service' }), token()], 'test-client.access', now)).toBe(token().id)
})

test('トークンの欠落・重複・取り違えを拒否する', () => {
  expect(() => selectVerificationToken([], 'test-client.access', now)).toThrow()
  expect(() => selectVerificationToken([token(), token()], 'test-client.access', now)).toThrow()
  expect(() => selectVerificationToken([token()], 'other-client.access', now)).toThrow()
})

test('無効・期限切れトークンを拒否する', () => {
  expect(() => selectVerificationToken([token({ enabled: false })], 'test-client.access', now)).toThrow()
  expect(() => selectVerificationToken([token({ expires_at: '2026-11-01T00:00:00Z' })], 'test-client.access', now)).toThrow()
})
