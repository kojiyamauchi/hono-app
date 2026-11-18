import { expect, test } from 'bun:test'

import { createScopedClient } from '../scopedClient'

test('非同期処理ごとのクライアント・メソッドのthisを保持し、例外後に復元する', async () => {
  let created = 0
  const create = (name: string): { name: string; read: () => string } => ({
    name,
    read() {
      return this.name
    },
  })
  const scoped = createScopedClient(() => {
    created++
    return create('bun')
  })
  expect(created).toBe(0)
  await Promise.all(
    ['first', 'second'].map((name) =>
      scoped.run(create(name), async () => {
        await Promise.resolve()
        expect(scoped.client.read()).toBe(name)
        expect(scoped.client.name).toBe(name)
      }),
    ),
  )
  expect(created).toBe(0)
  expect(() =>
    scoped.run(create('failed'), () => {
      throw new Error('test')
    }),
  ).toThrow('test')
  expect(scoped.client.read()).toBe('bun')
  expect(scoped.client.read()).toBe('bun')
  expect(created).toBe(1)
})
