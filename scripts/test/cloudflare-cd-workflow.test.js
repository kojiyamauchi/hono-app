// cspell:words rhysd
import { expect, test } from 'bun:test'

/** 実際のworkflow式で、共通CI・GCP・フラグの組合せを評価する。 */
function allowed(expression, ci, gcp, gcpEnabled, cloudflareEnabled, cancelled = false) {
  const js = expression
    .replaceAll('always()', 'true')
    .replaceAll('cancelled()', String(cancelled))
    .replaceAll('needs.ci.result', JSON.stringify(ci))
    .replaceAll('needs.deploy.result', JSON.stringify(gcp))
    .replaceAll('vars.GCP_DEV_CD_ENABLED', JSON.stringify(gcpEnabled))
    .replaceAll('vars.CLOUDFLARE_DEV_CD_ENABLED', JSON.stringify(cloudflareEnabled))
  return Function(`return (${js})`)()
}

test('共通CI全件を共有し、CI失敗・GCP失敗・キャンセル・未有効化を拒否する', async () => {
  const workflow = Bun.YAML.parse(await Bun.file('.github/workflows/cd-gcp.yml').text())
  expect(workflow.on).toEqual({ push: { branches: ['main'] } })
  expect(workflow.jobs.ci.uses).toBe('./.github/workflows/ci.yml')
  const job = workflow.jobs.cloudflare
  expect(job.needs).toEqual(['ci', 'deploy'])
  expect(job.uses).toBe('./.github/workflows/cd-cloudflare.yml')
  expect(allowed(job.if, 'success', 'success', 'true', 'true')).toBe(true)
  expect(allowed(job.if, 'success', 'skipped', '', 'true')).toBe(true)
  for (const status of ['failure', 'cancelled', 'skipped']) expect(allowed(job.if, status, 'success', 'true', 'true')).toBe(false)
  for (const status of ['failure', 'cancelled']) expect(allowed(job.if, 'success', status, '', 'true')).toBe(false)
  expect(allowed(job.if, 'success', 'skipped', 'true', 'true')).toBe(false)
  expect(allowed(job.if, 'success', 'success', 'true', '')).toBe(false)
  expect(allowed(job.if, 'success', 'success', 'true', 'true', true)).toBe(false)
  const ci = Bun.YAML.parse(await Bun.file('.github/workflows/ci.yml').text())
  for (const name of ['terraform-aws', 'terraform-gcp', 'terraform-cloudflare']) expect(ci.jobs[name].needs).toBeUndefined()
  expect(Object.keys(ci.jobs)).toContain('cloudflare-runtime')
  const syntax = ci.jobs.checks.steps.find((step) => step.name === 'Validate CD workflow syntax')
  expect(syntax.if).toBe("matrix.script == 'lint:check'")
  expect(syntax.run).toContain('rhysd/actionlint:1.7.12')
  expect(syntax.run).toContain('.github/workflows/cd-gcp.yml .github/workflows/cd-cloudflare.yml')
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
  const caller = Bun.YAML.parse(await Bun.file('.github/workflows/cd-gcp.yml').text())
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
