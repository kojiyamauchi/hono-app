import { expect, test } from 'bun:test'
import { Hono } from 'hono'

import { runWithRuntime } from '@/utils/runtime'

import { getClientIp } from '../common'

test('CloudflareではCF-Connecting-IPだけを使用し、利用者の転送ヘッダーを無視する', async () => {
  const app = new Hono().get('/', (c) => c.json({ ip: getClientIp(c) ?? null }))
  const invoke = (headers: Record<string, string>): Promise<Response> =>
    Promise.resolve(
      runWithRuntime({ env: {}, platform: 'cloudflare', password: { hash: async () => '', verify: async () => false } }, () => app.request('/', { headers })),
    )
  const response = await invoke({ 'cf-connecting-ip': '2001:db8::1', 'x-forwarded-for': '192.0.2.10', 'x-real-ip': '192.0.2.20' })
  expect(await response.json()).toEqual({ ip: '2001:db8::1' })
  const missing = await invoke({ 'x-forwarded-for': '192.0.2.10' })
  expect(await missing.json()).toEqual({ ip: null })
  const invalid = await invoke({ 'cf-connecting-ip': 'invalid', 'x-forwarded-for': '192.0.2.10' })
  expect(await invalid.json()).toEqual({ ip: null })
})
