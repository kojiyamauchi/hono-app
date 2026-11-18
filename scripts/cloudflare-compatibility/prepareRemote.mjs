import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { prepareClient } from './prepareClient.mjs'
import { prepareHashWasm } from './prepareHashWasm.mjs'

const directory = dirname(fileURLToPath(import.meta.url))
const terraformDirectory = resolve(directory, '../../infra/cloudflare')

/** Terraform出力の許可した項目だけを使い、秘密値・ローカルDB接続をremote configへ混入させない。 */
export const createRemoteConfig = (output, passwordVerifier = 'legacy', runtimeProfile = 'durable') => {
  assert(['legacy', 'native', 'modern'].includes(passwordVerifier), '検証用パスワード実装の指定が不正です')
  const entries = { standard: '../worker.mjs', 'lean-fast': '../workerLean.mjs', 'lean-small': '../workerLeanSmall.mjs', durable: '../workerDurable.mjs' }
  assert(Object.hasOwn(entries, runtimeProfile), '検証用Workerの構成指定が不正です')
  assert.match(output.account_id, /^[0-9a-f]{32}$/, 'Cloudflare account_idが不正です')
  assert.match(output.hyperdrive_id, /^[0-9a-f]{32}$/, 'Hyperdrive IDが不正です')
  assert.notEqual(output.hyperdrive_id, '00000000000000000000000000000000', '実際のHyperdrive IDが必要です')
  assert.match(output.worker_name, /^hono-app-[a-z0-9-]+-compatibility$/, '検証用Worker名が不正です')
  assert.match(output.worker_id, /^[0-9a-f]{32}$/, '適用済みWorkerのIDが必要です')
  assert.match(output.access_application_id, /^[0-9a-f-]{36}$/, '適用済みAccessアプリケーションのIDが必要です')
  assert.equal(typeof output.enable_worker_url, 'boolean', 'URL公開状態を明示してください')
  assert.equal(typeof output.automation_enabled, 'boolean', '自動検証ポリシーの状態を明示してください')
  assert(!output.enable_worker_url || output.automation_enabled, 'URL有効化には自動検証用サービストークンの設定が必要です')
  return {
    name: output.worker_name,
    account_id: output.account_id,
    main: entries[runtimeProfile],
    compatibility_date: '2026-11-16',
    compatibility_flags: ['nodejs_compat'],
    workers_dev: output.enable_worker_url,
    preview_urls: false,
    observability: {
      enabled: true,
      head_sampling_rate: 1,
      logs: { enabled: true, invocation_logs: true },
    },
    hyperdrive: [{ binding: 'HYPERDRIVE', id: output.hyperdrive_id }],
    ...(runtimeProfile === 'durable' ? durableObjectConfig : {}),
    vars: { ENABLE_DATABASE_CHECK: 'true', PASSWORD_VERIFIER: passwordVerifier },
  }
}

// Freeプランで利用できるSQLite型を使う。アプリのデータ移行・SQLiteへの書き込みは行わない。
export const durableObjectConfig = {
  durable_objects: { bindings: [{ name: 'COMPATIBILITY_EXECUTOR', class_name: 'CompatibilityExecutor' }] },
  migrations: [{ tag: 'compatibility-executor-v1', new_sqlite_classes: ['CompatibilityExecutor'] }],
}

/** stateだけに頼らず、配備直前にCloudflare上のAccess保護対象とポリシーの紐付けを確認する。 */
export const assertAccessProtection = (output, application) => {
  assert.equal(application.type, 'self_hosted', 'Accessアプリケーションの種類が異なります')
  assert.deepEqual(
    application.destinations?.map(({ type, worker_id }) => ({ type, worker_id })),
    [{ type: 'worker', worker_id: output.worker_id }],
    'Worker全体のAccess保護を確認できませんでした',
  )
  assert(output.access_policy_ids?.length > 0, 'Accessポリシーが未設定です')
  assert.deepEqual(application.policies?.map(({ id }) => id).sort(), [...output.access_policy_ids].sort(), 'Accessポリシーの紐付けがTerraformと異なります')
  assert.notEqual(application.options_preflight_bypass, true, 'OPTIONSの認証迂回は許可しません')
  assert(!application.read_service_tokens_from_header, 'Accessサービストークンは専用ヘッダーを使ってください')
  assert(!application.policies.some(({ decision }) => decision === 'bypass'), 'AccessのBypassポリシーは許可しません')
}

/** 検証Worker専用の秘密値を作成し、再配備では同じ値を使う。 */
const prepareSecret = async (generatedDirectory) => {
  const path = resolve(generatedDirectory, 'secrets.remote.json')
  try {
    await writeFile(path, JSON.stringify({ SPIKE_TOKEN: randomBytes(32).toString('hex') }), { mode: 0o600, flag: 'wx' })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  const secret = JSON.parse(await readFile(path, 'utf8'))
  assert.match(secret.SPIKE_TOKEN, /^[0-9a-f]{64}$/, '保存済みの検証用秘密値が不正です')
  await chmod(path, 0o600)
}

/** 適用済みTerraform stateからconfigを生成する。クラウド上の設定変更は行わない。 */
const main = async () => {
  assert(process.env.CLOUDFLARE_API_TOKEN, 'Terraform・Access確認用のCLOUDFLARE_API_TOKENをローカル環境ファイルへ設定してください')
  const result = spawnSync('terraform', [`-chdir=${terraformDirectory}`, 'output', '-json', 'remote_config'], {
    encoding: 'utf8',
    env: { ...process.env, TF_WORKSPACE: 'dev' },
  })
  assert.equal(result.status, 0, 'Cloudflare用backend・dev workspaceを初期化し、Terraformの初回適用を完了してください')
  const output = JSON.parse(result.stdout)
  const config = createRemoteConfig(
    output,
    process.env.CLOUDFLARE_SPIKE_PASSWORD_VERIFIER ?? 'legacy',
    process.env.CLOUDFLARE_SPIKE_RUNTIME_PROFILE ?? 'durable',
  )
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${output.account_id}/access/apps/${output.access_application_id}`, {
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  })
  assert(response.ok, `配備前のAccess確認に失敗しました (${response.status})`)
  const access = await response.json()
  assert(access.success, '配備前のAccess確認が成功しませんでした')
  assertAccessProtection(output, access.result)
  await prepareClient()
  await prepareHashWasm()
  const generatedDirectory = resolve(directory, '.wrangler')
  await mkdir(generatedDirectory, { recursive: true })
  await prepareSecret(generatedDirectory)
  await writeFile(resolve(generatedDirectory, 'wrangler.remote.json'), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  console.info('適用済みTerraformからremote configと検証用Secretファイルを準備しました', { worker: config.name, workersDevEnabled: config.workers_dev })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
