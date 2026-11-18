import { describe, expect, test } from 'bun:test'

import { getEnvironment, getRuntimePlatform, hashPassword, runWithRuntime, verifyPassword } from '..'

describe('実行環境の分離', () => {
  test('交互に進む非同期処理でも環境とパスワード実装を混線させない', async () => {
    const execute = (name: string): Promise<void> =>
      runWithRuntime(
        {
          env: { JWT_SECRET: name },
          platform: 'cloudflare',
          password: { hash: async (password) => `${name}:${password}`, verify: async (_password, hash) => hash === name },
        },
        async () => {
          await Promise.resolve()
          expect(getEnvironment().JWT_SECRET).toBe(name)
          expect(getRuntimePlatform()).toBe('cloudflare')
          expect(await hashPassword('password')).toBe(`${name}:password`)
          expect(await verifyPassword('password', name)).toBe(true)
        },
      )
    await Promise.all([execute('first'), execute('second')])
    expect(getEnvironment()).toBe(process.env)
    expect(getRuntimePlatform()).toBe('bun')
  })
})
