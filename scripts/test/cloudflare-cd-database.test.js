import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { assertCloudflareDatabaseTarget, verifyCloudflareDatabase } from '../cloudflare-cd-database.mjs'

/** 実migrationファイルと同じチェックサムの適用履歴を作る。 */
async function historyFixture() {
  const entries = await readdir('prisma/migrations', { withFileTypes: true })
  return Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async ({ name }) => ({
        migration_name: name,
        checksum: createHash('sha256')
          .update(await readFile(`prisma/migrations/${name}/migration.sql`))
          .digest('hex'),
        finished_at: new Date(),
        rolled_back_at: null,
      })),
  )
}

test('同じDBの完全適用履歴だけを許可し、読み取り専用・TLSと接続解放を維持する', async () => {
  const rows = await historyFixture()
  const calls = []
  let options
  class Client {
    constructor(config) {
      options = config
    }
    async connect() {
      calls.push('connect')
    }
    async query(sql) {
      calls.push(sql)
      return { rows }
    }
    async end() {
      calls.push('end')
    }
  }
  const origin = { host: 'db.example.com', database: 'postgres', port: 5432 }
  const url = 'postgresql://reader:secret@db.example.com:5432/postgres?sslmode=verify-full'
  await verifyCloudflareDatabase(url, origin, Client)
  expect(options.ssl.rejectUnauthorized).toBe(true)
  expect(options.ssl.ca.length).toBeGreaterThan(1)
  expect(options.connectionString).not.toContain('sslmode')
  expect(options.options).toBe('-c default_transaction_read_only=on')
  expect(calls).toEqual(['connect', 'SELECT migration_name, checksum, finished_at, rolled_back_at FROM public._prisma_migrations', 'SELECT 1', 'end'])
  for (const mutate of [
    (items) => items.pop(),
    (items) => {
      items[0].checksum = 'bad'
    },
    (items) => {
      items[0].finished_at = null
    },
  ]) {
    const saved = structuredClone(rows)
    mutate(rows)
    await expect(verifyCloudflareDatabase(url, origin, Client)).rejects.toThrow()
    expect(calls.at(-1)).toBe('end')
    rows.splice(0, rows.length, ...saved)
  }
  await expect(verifyCloudflareDatabase(url, { ...origin, host: 'other.example.com' }, Client)).rejects.toThrow()
  await expect(verifyCloudflareDatabase(url.replace('verify-full', 'require'), origin, Client)).rejects.toThrow()
})

test('IPv6専用の直接接続と同一プロジェクトのsession poolerを許可する', () => {
  const project = 'a'.repeat(20)
  const origin = { host: `db.${project}.supabase.co`, port: 5432, database: 'postgres' }
  const pooler = `postgresql://reader.${project}:secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full`
  expect(() => assertCloudflareDatabaseTarget(pooler, origin)).not.toThrow()
  expect(() => assertCloudflareDatabaseTarget(`postgresql://reader:secret@${origin.host}:5432/postgres?sslmode=verify-full`, origin)).not.toThrow()
})

for (const [name, change] of [
  [
    '別プロジェクト',
    (url) => {
      url.username = `reader.${'b'.repeat(20)}`
    },
  ],
  [
    'project refなし',
    (url) => {
      url.username = 'reader'
    },
  ],
  [
    '余分なuser suffix',
    (url) => {
      url.username += '.extra'
    },
  ],
  [
    'Supabase外のhost',
    (url) => {
      url.hostname = 'pooler.example.com'
    },
  ],
  [
    '偽のドメインsuffix',
    (url) => {
      url.hostname += '.example.com'
    },
  ],
  [
    'transaction pooler',
    (url) => {
      url.port = '6543'
    },
  ],
  [
    '別DB',
    (url) => {
      url.pathname = '/other'
    },
  ],
  [
    'TLS検証緩和',
    (url) => {
      url.searchParams.set('sslmode', 'require')
    },
  ],
])
  test(`session poolerで${name}を拒否する`, () => {
    const project = 'a'.repeat(20)
    const origin = { host: `db.${project}.supabase.co`, port: 5432, database: 'postgres' }
    const url = new URL(`postgresql://reader.${project}:secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full`)
    change(url)
    expect(() => assertCloudflareDatabaseTarget(url.toString(), origin)).toThrow()
  })

test('任意の外部DBをSupabase poolerへ付け替えることを拒否する', () => {
  const url = `postgresql://reader.${'a'.repeat(20)}:secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full`
  expect(() => assertCloudflareDatabaseTarget(url, { host: 'db.example.com', port: 5432, database: 'postgres' })).toThrow()
})
