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
})

test('PRから配備せず、環境の資格情報・固定依存・中断しない排他・削除を指定する', async () => {
  const workflow = Bun.YAML.parse(await Bun.file('.github/workflows/cd-cloudflare.yml').text())
  expect(Object.keys(workflow.on)).toEqual(['workflow_call'])
  const job = workflow.jobs.deploy
  expect(job.if).toContain("github.ref == 'refs/heads/main'")
  expect(job.if).toContain("github.event_name == 'push'")
  expect(job.environment).toBe('cloudflare-dev')
  expect(job.concurrency).toEqual({ group: 'cloudflare-dev-deployment', 'cancel-in-progress': false })
  expect(job.steps.find((step) => step.uses === 'actions/checkout@v6').with['persist-credentials']).toBe(false)
  expect(job.steps.some((step) => step.run === 'bun install --frozen-lockfile --ignore-scripts')).toBe(true)
  const deploy = job.steps.find((step) => step.run?.includes('cloudflare-cd.mjs deploy'))
  expect(Object.keys(deploy.env)).toHaveLength(6)
  expect(job.steps.at(-1).if).toBe('always()')
  expect(job.steps.at(-1).run).toContain('"$CLOUDFLARE_CD_DIR"')
})
