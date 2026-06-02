import { describe, expect, test } from 'bun:test'

import { app } from './app'

describe('GET /health', () => {
  test('正常状態を返す', async () => {
    const response = await app.request('/health')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })
})
