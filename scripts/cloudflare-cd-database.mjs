import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { rootCertificates } from 'node:tls'

import pg from 'pg'

import { assertDatabaseUrl, pendingMigrations } from './gcp-cd-policy.mjs'

/** Hyperdriveと同じDBへTLS検証付きで接続し、既存migrationの完全適用だけを確認する。 */
export async function verifyCloudflareDatabase(connectionString, origin, Client = pg.Client, directory = 'prisma/migrations') {
  assertDatabaseUrl(connectionString)
  const url = new URL(connectionString)
  assert.equal(url.hostname, origin.host)
  assert.equal(Number(url.port), origin.port)
  assert.equal(decodeURIComponent(url.pathname.slice(1)), origin.database)
  const entries = await readdir(directory, { withFileTypes: true })
  const names = entries
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => name)
    .sort()
  assert(names.length && names.every((name) => /^\d{14}_[a-z0-9_]+$/.test(name)))
  const migrations = await Promise.all(
    names.map(async (name) => ({
      name,
      checksum: createHash('sha256')
        .update(await readFile(`${directory}/${name}/migration.sql`))
        .digest('hex'),
    })),
  )
  // pgのURLパラメータによるsslオブジェクト上書きを避け、CAとホスト名の検証を明示する。
  url.search = ''
  const ca = await readFile('certificates/supabase-root-2021.crt', 'utf8')
  const client = new Client({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true, ca: [...rootCertificates, ca] },
    connectionTimeoutMillis: 15_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    options: '-c default_transaction_read_only=on',
  })
  try {
    await client.connect()
    const history = await client.query('SELECT migration_name, checksum, finished_at, rolled_back_at FROM public._prisma_migrations')
    assert.equal(pendingMigrations(migrations, history.rows).length, 0)
    await client.query('SELECT 1')
  } finally {
    await client.end()
  }
}
