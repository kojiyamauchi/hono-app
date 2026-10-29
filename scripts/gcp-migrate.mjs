import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'

import pg from 'pg'

import { assertDatabaseUrl, pendingMigrations } from './gcp-cd-policy.mjs'

/** 接続情報・SQLエラー・Prisma出力をログへ出さずにmigrationと履歴を確認する。 */
async function migrate() {
  assertDatabaseUrl(process.env.DATABASE_URL)
  const names = (await readdir('/app/prisma/migrations', { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  if (names.some((name) => !/^\d{14}_[a-z0-9_]+$/.test(name))) throw new Error('未対応のmigration名があります。')
  const migrations = await Promise.all(
    names.sort().map(async (name) => ({
      name,
      checksum: createHash('sha256')
        .update(await readFile(`/app/prisma/migrations/${name}/migration.sql`))
        .digest('hex'),
    })),
  )
  if (!migrations.length) throw new Error('migrationファイルがありません。')
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000, statement_timeout: 30000 })
  await client.connect()
  try {
    // 自動配備は既存環境だけを対象とする。履歴表がないDBの初期構築は行わない。
    const history = async () => (await client.query('SELECT migration_name, checksum, finished_at, rolled_back_at FROM public._prisma_migrations')).rows
    const pending = pendingMigrations(migrations, await history())
    console.info(`未適用migration: ${pending.length}件`)
    if (pending.length) {
      const result = spawnSync('bun', ['run', 'prisma:migrate:deploy'], { stdio: 'pipe', timeout: 300000 })
      if (result.error || result.status !== 0) throw new Error('migration適用に失敗しました。接続情報を伏せて個別に調査してください。')
    }
    if (pendingMigrations(migrations, await history()).length) throw new Error('未適用migrationが残っています。')
    await client.query('SELECT 1')
    console.info('migration履歴・チェックサム・DB読み取りの確認成功')
  } finally {
    await client.end()
  }
}

if (import.meta.main) {
  try {
    await migrate()
  } catch {
    console.error('DB検証またはmigrationに失敗しました。Cloud Runの更新を停止します。秘密値を含む診断は出力しません。')
    process.exitCode = 1
  }
}
