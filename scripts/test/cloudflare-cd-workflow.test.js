// cspell:words rhysd
import { expect, test } from 'bun:test'

/** 実際のmigration条件を、GitHub Actionsのジョブ結果を使って評価する。 */
function allowed(
  expression,
  {
    current = 'success',
    deploy = 'true',
    currentAttempt = '2',
    migration = 'success',
    migratedAttempt = '2',
    preparedAttempt = '2',
    gcp = 'success',
    gcpEnabled = 'true',
    cloudflareEnabled = 'true',
    cancelled = false,
  } = {},
) {
  const js = expression
    .replaceAll('cancelled()', String(cancelled))
    .replaceAll('needs.current.outputs.attempt', JSON.stringify(currentAttempt))
    .replaceAll('needs.gcp-prepare.outputs.prepared-attempt', JSON.stringify(preparedAttempt))
    .replaceAll('needs.migration.result', JSON.stringify(migration))
    .replaceAll('needs.migration.outputs.migrated-attempt', JSON.stringify(migratedAttempt))
    .replaceAll('github.run_attempt', JSON.stringify('2'))
    .replaceAll('needs.current.result', JSON.stringify(current))
    .replaceAll('needs.current.outputs.deploy', JSON.stringify(deploy))
    .replaceAll('needs.gcp-prepare.result', JSON.stringify(gcp))
    .replaceAll('vars.GCP_DEV_CD_ENABLED', JSON.stringify(gcpEnabled))
    .replaceAll('vars.CLOUDFLARE_DEV_CD_ENABLED', JSON.stringify(cloudflareEnabled))
  return Function(`return (${js})`)()
}

test('共通CI後にAWSと共有リリースへ分岐し、共有リリース内でmigration後に両配備を開始する', async () => {
  const workflow = Bun.YAML.parse(await Bun.file('.github/workflows/cd.yml').text())
  const shared = Bun.YAML.parse(await Bun.file('.github/workflows/cd-shared-dev.yml').text())
  const aws = Bun.YAML.parse(await Bun.file('.github/workflows/cd-aws.yml').text())
  expect(workflow.on).toEqual({ push: { branches: ['main'] } })
  expect(workflow.jobs.ci.uses).toBe('./.github/workflows/ci.yml')
  expect(workflow.jobs.aws.needs).toBe('ci')
  expect(workflow.jobs['shared-dev'].needs).toBe('ci')
  expect(Object.keys(aws.on).sort()).toEqual(['workflow_call', 'workflow_dispatch'])
  expect(shared.concurrency).toEqual({ group: 'shared-dev-release', 'cancel-in-progress': false })
  expect(shared.jobs['gcp-prepare'].needs).toBe('current')
  const migration = shared.jobs.migration
  expect(migration.needs).toEqual(['current', 'gcp-prepare'])
  expect(allowed(migration.if)).toBe(true)
  expect(allowed(migration.if, { cloudflareEnabled: '' })).toBe(true)
  expect(allowed(migration.if, { gcpEnabled: '', gcp: 'skipped' })).toBe(true)
  for (const options of [
    { gcp: 'failure' },
    { gcp: 'cancelled' },
    { gcp: 'skipped' },
    { gcpEnabled: '', gcp: 'skipped', cloudflareEnabled: '' },
    { current: 'failure' },
    { deploy: '' },
    { currentAttempt: '1' },
    { preparedAttempt: '1' },
    { cancelled: true },
  ])
    expect(allowed(migration.if, options)).toBe(false)
  for (const cloud of ['gcp', 'cloudflare']) {
    expect(shared.jobs[cloud].needs).toBe('migration')
    const condition = shared.jobs[cloud].if
    expect(allowed(condition)).toBe(true)
    expect(allowed(condition, { migration: 'failure' })).toBe(false)
    expect(allowed(condition, { migratedAttempt: '1' })).toBe(false)
    expect(allowed(condition, { cancelled: true })).toBe(false)
    expect(allowed(condition, cloud === 'gcp' ? { gcpEnabled: '' } : { cloudflareEnabled: '' })).toBe(false)
  }
  const ci = Bun.YAML.parse(await Bun.file('.github/workflows/ci.yml').text())
  for (const name of ['terraform-aws', 'terraform-gcp', 'terraform-cloudflare']) expect(ci.jobs[name].needs).toBeUndefined()
  expect(Object.keys(ci.jobs)).toContain('cloudflare-runtime')
  const syntax = ci.jobs.checks.steps.find((step) => step.name === 'Validate CD workflow syntax')
  expect(syntax.if).toBe("matrix.script == 'lint:check'")
  expect(syntax.run).toContain('rhysd/actionlint:1.7.12')
  expect(syntax.run).toContain('.github/workflows/*.yml')
})

test('PRから配備せず、環境の資格情報・固定依存・中断しない排他・削除を指定する', async () => {
  const workflow = Bun.YAML.parse(await Bun.file('.github/workflows/cd-cloudflare.yml').text())
  expect(Object.keys(workflow.on)).toEqual(['workflow_call'])
  const job = workflow.jobs.deploy
  expect(job.if).toContain("github.ref == 'refs/heads/main'")
  expect(job.if).toContain("github.event_name == 'push'")
  expect(job.environment).toBe('cloudflare-dev')
  expect(JSON.stringify(job.env)).not.toContain('runner.')
  expect(job.steps[0].run).toContain('umask 077')
  expect(job.steps[0].run).toContain('$RUNNER_TEMP')
  expect(job.steps[0].run).toContain('$GITHUB_ENV')
  expect(job.concurrency).toEqual({ group: 'cloudflare-dev-deployment', 'cancel-in-progress': false })
  expect(job.steps.find((step) => step.uses === 'actions/checkout@v6').with['persist-credentials']).toBe(false)
  expect(job.steps.some((step) => step.run === 'bun install --frozen-lockfile --ignore-scripts')).toBe(true)
  const deploy = job.steps.find((step) => step.run?.includes('cloudflare-cd.mjs deploy'))
  expect(Object.keys(deploy.env)).toHaveLength(6)
  expect(job.steps.at(-1).if).toBe('always()')
  expect(job.steps.at(-1).run).toContain('"$CLOUDFLARE_CD_DIR"')
})

test('Cloudflare用の6件だけを呼び出し元から必須Secretとして渡し、環境内の配備ステップへ接続する', async () => {
  const caller = Bun.YAML.parse(await Bun.file('.github/workflows/cd-shared-dev.yml').text())
  const callee = Bun.YAML.parse(await Bun.file('.github/workflows/cd-cloudflare.yml').text())
  const names = [
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_CD_CONFIG',
    'CLOUDFLARE_APP_SECRETS',
    'CLOUDFLARE_ACCESS_CLIENT_ID',
    'CLOUDFLARE_ACCESS_CLIENT_SECRET',
    'CLOUDFLARE_DATABASE_URL',
  ]
  const forwarded = caller.jobs.cloudflare.secrets
  const required = callee.on.workflow_call.secrets
  const deploy = callee.jobs.deploy.steps.find((step) => step.run?.includes('cloudflare-cd.mjs deploy'))
  expect(typeof forwarded).toBe('object')
  for (const boundary of [forwarded, required, deploy.env]) expect(Object.keys(boundary).sort()).toEqual([...names].sort())
  for (const name of names) {
    expect(forwarded[name]).toBe('${{ secrets.' + name + ' }}')
    expect(required[name]).toEqual({ required: true })
    expect(deploy.env[name]).toBe('${{ secrets.' + name + ' }}')
  }
  expect(callee.jobs.deploy.environment).toBe('cloudflare-dev')
})

test('GCPの暗号化用Secret名を準備と配備の両方へ明示的に渡す', async () => {
  const entry = Bun.YAML.parse(await Bun.file('.github/workflows/cd.yml').text())
  const shared = Bun.YAML.parse(await Bun.file('.github/workflows/cd-shared-dev.yml').text())
  const gcp = Bun.YAML.parse(await Bun.file('.github/workflows/cd-gcp.yml').text())
  const reference = '${{ secrets.GCP_CD_PLAN_KEY }}'
  expect(entry.jobs['shared-dev'].secrets.GCP_CD_PLAN_KEY).toBe(reference)
  for (const workflow of [shared, gcp]) expect(workflow.on.workflow_call.secrets.GCP_CD_PLAN_KEY).toEqual({ required: true })
  for (const job of ['gcp-prepare', 'gcp']) expect(shared.jobs[job].secrets.GCP_CD_PLAN_KEY).toBe(reference)
  for (const job of ['prepare', 'deploy']) {
    expect(gcp.jobs[job].environment).toBe('gcp-dev')
    expect(gcp.jobs[job].steps.filter((step) => step.env?.PLAN_KEY).map((step) => step.env.PLAN_KEY)).toEqual([reference])
  }
})
