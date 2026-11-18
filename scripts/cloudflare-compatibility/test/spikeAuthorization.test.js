import { expect, test } from 'bun:test'

import { isSpikeRequestAuthorized } from '../spikeAuthorization.mjs'

test('検証用Bearerを照合し、同じ長さの誤り・長さ違い・方式違い・未設定を拒否する', () => {
  const token = 'a'.repeat(64)
  const request = (authorization) => new Request('https://example.invalid/ready', { headers: authorization ? { authorization } : {} })
  expect(isSpikeRequestAuthorized(request(`Bearer ${token}`), token)).toBe(true)
  for (const authorization of [undefined, `Bearer ${'a'.repeat(63)}b`, `Bearer ${token}a`, `Bearer ${token.slice(1)}`, `bearer ${token}`, `Basic ${token}`]) {
    expect(isSpikeRequestAuthorized(request(authorization), token)).toBe(false)
  }
  for (const missing of [undefined, null, '']) expect(isSpikeRequestAuthorized(request(`Bearer ${token}`), missing)).toBe(false)
})
