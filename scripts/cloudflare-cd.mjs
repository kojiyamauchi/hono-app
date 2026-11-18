import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { activeCloudflareVersion, cloudflareApi, verifyCloudflareHttp, verifyCloudflareInfrastructure } from './cloudflare-cd-api.mjs'
import { verifyCloudflareDatabase } from './cloudflare-cd-database.mjs'
import { assertCloudflareConfig, cloudflareAppSecrets, createCloudflareConfig } from './cloudflare-cd-policy.mjs'

/** CLI出力をログへ返さず、失敗も固定メッセージへ変換する。 */
export function executeCloudflare(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 5 * 60_000, maxBuffer: 16 * 1024 * 1024 })
  assert(!result.error && result.status === 0, 'Cloudflare CDの子プロセスが失敗しました')
  return result.stdout.trim()
}

/** 待機中に古くなったSHAを、クラウド変更前に省略する。 */
export function isCurrentCloudflareSha(sha, run = executeCloudflare) {
  assert.match(sha ?? '', /^[a-f0-9]{40}$/)
  const remote = run('git', ['ls-remote', 'https://github.com/kojiyamauchi/hono-app.git', 'refs/heads/main'])
  assert.match(remote, /^[a-f0-9]{40}\s+refs\/heads\/main$/)
  return remote.split(/\s+/)[0] === sha
}

/** URL無効の初回配備と、有効化済み本体への通常配備を同じ確認経路で実行する。 */
export async function deployCloudflare({ config, secrets, sha, directory, bootstrap = false, credentials, databaseUrl, summaryPath }, dependencies = {}) {
  const run = dependencies.run ?? executeCloudflare
  const api = dependencies.api ?? cloudflareApi(config, process.env.CLOUDFLARE_API_TOKEN)
  const infrastructure = dependencies.infrastructure ?? verifyCloudflareInfrastructure
  const database = dependencies.database ?? verifyCloudflareDatabase
  const http = dependencies.http ?? verifyCloudflareHttp
  const active = dependencies.active ?? activeCloudflareVersion
  assertCloudflareConfig(config)
  assert.equal(config.enable_worker_url, !bootstrap)
  assert.match(sha ?? '', /^[a-f0-9]{40}$/)
  assert(directory && resolve(directory) !== process.cwd())
  const appSecrets = cloudflareAppSecrets(secrets)
  if (!bootstrap && !isCurrentCloudflareSha(sha, run)) return 'outdated'
  if (!bootstrap) assert(credentials?.id && credentials?.secret)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const configPath = resolve(directory, 'wrangler.json')
  const secretPath = resolve(directory, 'secrets.json')
  const record = { sha, previous: null, current: null }
  try {
    const template = JSON.parse(await readFile('wrangler.json', 'utf8'))
    await writeFile(configPath, JSON.stringify(createCloudflareConfig(config, template, process.cwd())), { mode: 0o600 })
    const origin = await infrastructure(config, api)
    await database(databaseUrl, origin)
    if (!bootstrap) record.previous = await active(config, api)
    run('bun', ['run', 'cloudflare:prepare'])
    run('bun', ['x', '--no-install', 'wrangler', 'deploy', '--config', configPath, '--dry-run', '--outdir', resolve(directory, 'build')])
    // ビルド中に新mainが出た場合も、まだクラウドへ変更を加えず省略できる。
    if (!bootstrap && !isCurrentCloudflareSha(sha, run)) return 'outdated'
    await infrastructure(config, api)
    await database(databaseUrl, origin)
    await writeFile(secretPath, JSON.stringify(appSecrets), { mode: 0o600 })
    // コードとSecretを同じversionへ配備し、URL/previewは承認済みの値を維持する。
    await writeFile(resolve(directory, 'release.json'), JSON.stringify(record), { mode: 0o600 })
    if (summaryPath)
      await appendFile(summaryPath, `\n## Cloudflare dev配備\n\n- ソースSHA: \`${sha}\`\n- 復旧用version: \`${record.previous ?? '初回配備'}\`\n`)
    run('bun', ['x', '--no-install', 'wrangler', 'deploy', '--config', configPath, '--secrets-file', secretPath, '--tag', sha])
    record.current = await active(config, api, sha)
    await writeFile(resolve(directory, 'release.json'), JSON.stringify(record), { mode: 0o600 })
    await infrastructure(config, api)
    if (!bootstrap) await http(config, credentials)
    assert.equal(await active(config, api, sha), record.current)
    if (summaryPath)
      await appendFile(summaryPath, `- 配備version: \`${record.current}\`\n- Access・DB履歴・稼働SHA・${bootstrap ? 'URL無効' : 'HTTP'}検証: 成功\n`)
    console.info(bootstrap ? 'URL無効の初回配備に成功しました。' : 'Cloudflare devの配備と保護検証に成功しました。')
    return record
  } finally {
    await rm(secretPath, { force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert(['deploy', 'bootstrap'].includes(process.argv[2]))
    const result = await deployCloudflare({
      config: JSON.parse(process.env.CLOUDFLARE_CD_CONFIG),
      secrets: JSON.parse(process.env.CLOUDFLARE_APP_SECRETS),
      sha: process.env.GITHUB_SHA,
      directory: process.env.CLOUDFLARE_CD_DIR,
      bootstrap: process.argv[2] === 'bootstrap',
      credentials: { id: process.env.CLOUDFLARE_ACCESS_CLIENT_ID, secret: process.env.CLOUDFLARE_ACCESS_CLIENT_SECRET },
      databaseUrl: process.env.CLOUDFLARE_DATABASE_URL,
      summaryPath: process.env.GITHUB_STEP_SUMMARY,
    })
    if (result === 'outdated') console.info('新しいmainがあるため、古いSHAの配備を省略しました。')
  } catch {
    console.error('Cloudflare CDに失敗しました。後続処理を停止します。秘密値を含む診断は出力しません。')
    process.exitCode = 1
  }
}
