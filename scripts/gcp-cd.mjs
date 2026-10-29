import { spawnSync } from 'node:child_process'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { assertDatabaseUrl, assertDeploymentPlan, DeploymentError, obsoleteReleaseTags } from './gcp-cd-policy.mjs'

/** CLIの生出力には秘密値が含まれ得るため、失敗時もコマンド名だけを返す。 */
export function execute(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 20 * 60 * 1000 })
  if (result.error || result.status !== 0) throw new DeploymentError(`${command}の実行に失敗しました。生出力は機密保護のため表示しません。`)
  return result.stdout.trim()
}

/** dev固定の設定とrunnerの一時領域を読み込む。 */
export async function createDeployment(run = execute) {
  const config = JSON.parse(await readFile('infra/gcp/env/dev.cd.tfvars.json', 'utf8'))
  const sha = process.env.GITHUB_SHA
  const runId = process.env.GITHUB_RUN_ID
  const attempt = process.env.GITHUB_RUN_ATTEMPT
  if (!/^[a-f0-9]{40}$/.test(sha ?? '') || !/^\d+$/.test(runId ?? '') || !/^\d+$/.test(attempt ?? '') || !process.env.GCP_CD_DIR) {
    throw new DeploymentError('GitHubの配備識別情報が不正です。')
  }
  if (config.project_id !== 'hono-app-dev-512908-f3' || config.region !== 'asia-northeast1' || process.env.TF_WORKSPACE !== 'dev') {
    throw new DeploymentError('dev以外の環境へ自動配備できません。')
  }
  const directory = resolve(process.env.GCP_CD_DIR)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const project = config.project_id
  const region = config.region
  const service = 'hono-app-dev'
  const imagePath = `${region}-docker.pkg.dev/${project}/${service}/hono`
  const tag = `candidate-${sha}-${runId}-${attempt}`
  const planPath = `${directory}/release.tfplan`
  const recordPath = `${directory}/release.json`
  const gcloud = (...args) => run('gcloud', ['--configuration=hono-app-dev', '--quiet', ...args, `--project=${project}`])
  const terraform = (...args) => run('terraform', ['-chdir=infra/gcp', ...args])
  const record = async () => {
    const result = JSON.parse(await readFile(recordPath, 'utf8'))
    if (
      result.sha !== sha ||
      result.image !== `${imagePath}@${result.digest}` ||
      !/^sha256:[a-f0-9]{64}$/.test(result.digest) ||
      !/^sha256:[a-f0-9]{64}$/.test(result.previous)
    ) {
      throw new DeploymentError('配備記録と対象SHAが一致しません。')
    }
    return result
  }
  const serviceState = () =>
    JSON.parse(
      gcloud(
        'run',
        'services',
        'describe',
        service,
        `--region=${region}`,
        '--format=json(status.latestReadyRevisionName,status.latestCreatedRevisionName,status.traffic,metadata.annotations)',
      ),
    )
  const readyDigest = (state) => {
    const ready = state.status?.latestReadyRevisionName
    const traffic = state.status?.traffic
    if (
      !ready ||
      ready !== state.status.latestCreatedRevisionName ||
      traffic?.length !== 1 ||
      traffic[0].percent !== 100 ||
      traffic[0].revisionName !== ready ||
      state.metadata?.annotations?.['run.googleapis.com/iap-enabled'] !== 'true'
    ) {
      throw new DeploymentError('サービスが安定したIAP保護済みの単一revisionではありません。')
    }
    const image = gcloud('run', 'revisions', 'describe', ready, `--region=${region}`, '--format=value(status.imageDigest)')
    if (!image.startsWith(`${imagePath}@sha256:`)) throw new DeploymentError('稼働中のイメージ登録先が一致しません。')
    const digest = image.slice(imagePath.length + 1)
    if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new DeploymentError('稼働中digestが不正です。')
    return digest
  }
  const readPlan = () => JSON.parse(terraform('show', '-json', planPath))
  const planArgs = (digest) => [
    'plan',
    '-input=false',
    '-no-color',
    '-lock-timeout=60s',
    '-var-file=env/dev.cd.tfvars.json',
    `-var=app_image_digest=${digest}`,
    `-out=${planPath}`,
  ]

  return {
    /** 既存環境を全体refreshし、イメージ以外の変更がないplanを保存する。 */
    async plan() {
      await Promise.all(['release.json', 'migration-ok', 'verified'].map((name) => rm(`${directory}/${name}`, { force: true })))
      const main = run('git', ['ls-remote', 'https://github.com/kojiyamauchi/hono-app.git', 'refs/heads/main']).split(/\s/)[0]
      if (main !== sha) throw new DeploymentError('新しいmainがあるため古い配備を停止しました。')
      const previous = readyDigest(serviceState())
      const digest = gcloud('artifacts', 'docker', 'images', 'describe', `${imagePath}:${tag}`, '--format=value(image_summary.digest)')
      if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new DeploymentError('登録済みdigestを確認できません。')
      const image = `${imagePath}@${digest}`
      terraform('init', '-input=false', '-lockfile=readonly', `-backend-config=bucket=${config.github_cd.state_bucket}`, '-backend-config=prefix=hono-app/gcp')
      terraform(...planArgs(digest))
      assertDeploymentPlan(readPlan(), image)
      await writeFile(recordPath, JSON.stringify({ sha, digest, image, previous }), { mode: 0o600 })
      if (process.env.GITHUB_STEP_SUMMARY) {
        await writeFile(process.env.GITHUB_STEP_SUMMARY, `\n配備対象SHA: \`${sha}\` / 候補digest: \`${digest}\` / 直前digest: \`${previous}\`\n`, { flag: 'a' })
      }
      console.info(`配備plan確認成功: ${sha} / ${digest}`)
    },
    /** DB用の短命認証に切り替えた後、固定Secretの数値versionだけでmigrationを実行する。 */
    async migrate() {
      await Promise.all(['migration-ok', 'verified'].map((name) => rm(`${directory}/${name}`, { force: true })))
      await record()
      const secretPath = `${directory}/database.value`
      const envPath = `${directory}/migration.env`
      try {
        gcloud('secrets', 'versions', 'access', config.secret_versions.DATABASE_URL, '--secret=hono-app-dev-database-url', `--out-file=${secretPath}`)
        await chmod(secretPath, 0o600)
        const url = (await readFile(secretPath, 'utf8')).trim()
        assertDatabaseUrl(url)
        await writeFile(envPath, `DATABASE_URL=${url}\n`, { mode: 0o600 })
        run('docker', [
          'run',
          '--rm',
          '--platform',
          'linux/amd64',
          '--env-file',
          envPath,
          '--mount',
          `type=bind,source=${resolve('scripts/gcp-migrate.mjs')},target=/app/gcp-migrate.mjs,readonly`,
          '--mount',
          `type=bind,source=${resolve('scripts/gcp-cd-policy.mjs')},target=/app/gcp-cd-policy.mjs,readonly`,
          'hono-cd:migration',
          'bun',
          '/app/gcp-migrate.mjs',
        ])
      } finally {
        await Promise.all([secretPath, envPath].map((path) => rm(path, { force: true })))
      }
      await writeFile(`${directory}/migration-ok`, sha, { mode: 0o600 })
      console.info('migrationとDB読み取りの確認成功')
    },
    /** migration成功印と保存planを再検査し、同じplanを適用する。 */
    async apply() {
      const release = await record()
      if ((await readFile(`${directory}/migration-ok`, 'utf8')) !== sha) throw new DeploymentError('migration成功を確認できません。')
      assertDeploymentPlan(readPlan(), release.image)
      if (readyDigest(serviceState()) !== release.previous) throw new DeploymentError('plan作成後に配備状態が変わりました。')
      for (const digest of new Set([release.previous, release.digest])) {
        gcloud('artifacts', 'docker', 'tags', 'add', `${imagePath}@${digest}`, `${imagePath}:release-${digest.slice(7)}`)
      }
      terraform('apply', '-input=false', '-no-color', planPath)
      const deployed = serviceState()
      if (readyDigest(deployed) !== release.digest) throw new DeploymentError('配備後の実digestが一致しません。')
      terraform(...planArgs(release.digest))
      assertDeploymentPlan(readPlan(), release.image, true)
      await writeFile(recordPath, JSON.stringify({ ...release, revision: deployed.status.latestReadyRevisionName }), { mode: 0o600 })
      console.info('Cloud Runのrevision・digest・再planの確認成功')
    },
    /** IAP専用認証で固定Originを確認する。認証値や応答全体は表示しない。 */
    async verify(fetcher = fetch) {
      await record()
      const origin = 'https://hono-app-dev-669070496198.asia-northeast1.run.app'
      const options = { redirect: 'manual', signal: AbortSignal.timeout(30000) }
      const anonymous = await fetcher(`${origin}/health`, options)
      if (![302, 401, 403].includes(anonymous.status) || anonymous.headers.get('x-goog-iap-generated-response') !== 'true') {
        throw new DeploymentError('未認証アクセスがIAPで遮断されていません。')
      }
      const token = process.env.IAP_ACCESS_TOKEN
      if (!token) throw new DeploymentError('IAP用の短命トークンがありません。')
      const authenticated = await fetcher(`${origin}/health`, {
        ...options,
        signal: AbortSignal.timeout(30000),
        headers: { 'Proxy-Authorization': `Bearer ${token}` },
      })
      if (authenticated.status !== 200 || authenticated.headers.has('x-goog-iap-generated-response') || (await authenticated.json()).ok !== true) {
        throw new DeploymentError('IAP認証付きhealthの確認に失敗しました。')
      }
      await writeFile(`${directory}/verified`, sha, { mode: 0o600 })
      console.info('未認証拒否とIAP認証付きhealthの確認成功')
    },
    /** 配備検証成功後だけ、現行と直前以外のrelease保護タグを外す。イメージ自体は削除しない。 */
    async cleanup() {
      const release = await record()
      if ((await readFile(`${directory}/verified`, 'utf8')) !== sha || readyDigest(serviceState()) !== release.digest)
        throw new DeploymentError('配備検証成功を確認できません。')
      const tags = JSON.parse(gcloud('artifacts', 'docker', 'tags', 'list', imagePath, '--format=json(tag,version)'))
      for (const { tag: obsolete } of obsoleteReleaseTags(tags, release.digest, release.previous)) {
        // 一覧のtagをコマンド引数へそのまま渡さず、固定リポジトリ内の検証済みタグ名から再構成する。
        gcloud('artifacts', 'docker', 'tags', 'delete', `${imagePath}:${obsolete.split('/').at(-1)}`)
      }
      gcloud('artifacts', 'docker', 'tags', 'delete', `${imagePath}:${tag}`)
      const summary = `\n## GCP dev配備\n\n- ソースSHA: \`${sha}\`\n- Ready revision: \`${release.revision}\`\n- 配備digest: \`${release.digest}\`\n- 復旧用digest: \`${release.previous}\`\n- migration・revision・IAP・再plan: 成功\n`
      if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, summary, { flag: 'a' })
      console.info('現行・復旧用の保護タグを維持しました。削除待ちを含む保存容量は別途確認してください。')
    },
  }
}

if (import.meta.main) {
  try {
    const deployment = await createDeployment()
    const phase = process.argv[2]
    if (!['plan', 'migrate', 'apply', 'verify', 'cleanup'].includes(phase)) throw new DeploymentError('配備フェーズが不正です。')
    await deployment[phase]()
  } catch (error) {
    // URL・JSON・外部CLI由来の例外文には入力値が含まれ得るため、そのまま表示しない。
    console.error(error instanceof DeploymentError ? error.message : 'GCP dev配備を停止しました。秘密値を伏せて個別に調査してください。')
    process.exitCode = 1
  }
}
