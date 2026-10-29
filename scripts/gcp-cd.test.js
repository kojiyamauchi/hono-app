import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, writeFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { imagePath, imagePlan, newDigest, oldDigest } from './gcp-cd-fixtures.js'
import { createDeployment, execute } from './gcp-cd.mjs'

const sha = 'd'.repeat(40)
let directory
let originalEnvironment

beforeEach(async () => {
  originalEnvironment = { ...process.env }
  directory = await mkdtemp(join(tmpdir(), 'hono-cd-test-'))
  Object.assign(process.env, {
    GITHUB_SHA: sha,
    GITHUB_RUN_ID: '100',
    GITHUB_RUN_ATTEMPT: '1',
    TF_WORKSPACE: 'dev',
    GCP_CD_DIR: directory,
    IAP_ACCESS_TOKEN: 'test-iap-token',
    GITHUB_STEP_SUMMARY: join(directory, 'summary'),
  })
})

afterEach(async () => {
  process.env = originalEnvironment
  await rm(directory, { recursive: true, force: true })
})

/** 外部コマンドの境界を差し替え、失敗時にどこまで実行されたか検証する。 */
function fakeCommands({ invalidPlan = false, migrationFails = false, stale = false, tlsMode = 'verify-full', postPlanDrift = false } = {}) {
  const calls = []
  let applied = false
  let planCount = 0
  const run = (command, args) => {
    calls.push({ command, args })
    if (command === 'git') return `${stale ? '0'.repeat(40) : sha}\trefs/heads/main`
    if (command === 'terraform') {
      if (args.includes('apply')) applied = true
      if (args.includes('plan')) planCount++
      if (args.includes('show')) {
        const plan = imagePlan()
        if (invalidPlan || (postPlanDrift && planCount > 1)) plan.resource_changes[0].change.after.iap_enabled = false
        if (planCount > 1) {
          plan.resource_changes[0].change.actions = ['no-op']
          plan.resource_changes[0].change.before = structuredClone(plan.resource_changes[0].change.after)
          plan.resource_changes[0].change.after_unknown = {}
        }
        return JSON.stringify(plan)
      }
      return ''
    }
    if (command === 'gcloud') {
      expect(args).toContain('--configuration=hono-app-dev')
      expect(args).toContain('--project=hono-app-dev-512908-f3')
      if (args.includes('services'))
        return JSON.stringify({
          metadata: { annotations: { 'run.googleapis.com/iap-enabled': 'true' } },
          status: { latestReadyRevisionName: 'ready', latestCreatedRevisionName: 'ready', traffic: [{ revisionName: 'ready', percent: 100 }] },
        })
      if (args.includes('revisions')) return `${imagePath}@${applied ? newDigest : oldDigest}`
      if (args.includes('images')) return newDigest
      if (args.includes('secrets')) {
        expect(args).toContain('2')
        expect(args).toContain('--secret=hono-app-dev-database-url')
        writeFileSync(
          args.find((value) => value.startsWith('--out-file=')).slice('--out-file='.length),
          `postgresql://postgres:secret-value@localhost:5432/postgres?sslmode=${tlsMode}`,
        )
      }
      if (args.includes('list')) return JSON.stringify([{ tag: `tags/release-${'c'.repeat(64)}`, version: `versions/sha256:${'c'.repeat(64)}` }])
      return ''
    }
    if (command === 'docker') {
      expect(args).toContain('hono-cd:migration')
      expect(args.join(' ')).not.toContain('secret-value')
      expect(existsSync(join(directory, 'migration.env'))).toBe(true)
      if (migrationFails) throw new Error('migration失敗')
      return ''
    }
    throw new Error('想定外のコマンドです。')
  }
  return { run, calls }
}

/** IAP拒否と認証済みhealthを返すHTTP境界。 */
function healthyIap(_url, options) {
  if (!options.headers) return new Response(null, { status: 302, headers: { 'x-goog-iap-generated-response': 'true' } })
  expect(options.headers['Proxy-Authorization']).toBe('Bearer test-iap-token')
  expect(options.redirect).toBe('manual')
  return Response.json({ ok: true })
}

describe('dev配備の停止条件と実行順序', () => {
  test('plan→migration→apply→IAP検証→タグ整理の順で成功する', async () => {
    const { run, calls } = fakeCommands()
    const deployment = await createDeployment(run)
    await deployment.plan()
    await deployment.migrate()
    await deployment.apply()
    await deployment.verify(healthyIap)
    await deployment.cleanup()
    const migrationIndex = calls.findIndex(({ command }) => command === 'docker')
    const applyIndex = calls.findIndex(({ command, args }) => command === 'terraform' && args.includes('apply'))
    const deleteIndex = calls.findIndex(({ command, args }) => command === 'gcloud' && args.includes('delete'))
    expect(migrationIndex).toBeLessThan(applyIndex)
    expect(applyIndex).toBeLessThan(deleteIndex)
    expect(calls.some(({ args }) => args.includes(`${imagePath}:release-${oldDigest.slice(7)}`))).toBe(true)
    expect(existsSync(join(directory, 'database.value'))).toBe(false)
    expect(existsSync(join(directory, 'migration.env'))).toBe(false)
    expect(await readFile(join(directory, 'summary'), 'utf8')).toContain(newDigest)
  })
  test('mainが進んでいたらクラウド操作前に停止する', async () => {
    const { run, calls } = fakeCommands({ stale: true })
    await expect((await createDeployment(run)).plan()).rejects.toThrow()
    expect(calls.every(({ command }) => command === 'git')).toBe(true)
  })
  test('権限・設定のplan差分があればDB取得もapplyも実行しない', async () => {
    const { run, calls } = fakeCommands({ invalidPlan: true })
    await expect((await createDeployment(run)).plan()).rejects.toThrow()
    expect(calls.some(({ args }) => args.includes('secrets') || args.includes('apply'))).toBe(false)
    expect(existsSync(join(directory, 'release.json'))).toBe(false)
  })
  test('migration成功前にはapplyできない', async () => {
    const { run, calls } = fakeCommands()
    const deployment = await createDeployment(run)
    await deployment.plan()
    await expect(deployment.apply()).rejects.toThrow()
    expect(calls.some(({ args }) => args.includes('apply'))).toBe(false)
  })
  test.each([
    ['migration失敗', { migrationFails: true }],
    ['TLS検証無効', { tlsMode: 'require' }],
  ])('%sなら成功印を作らず秘密値の一時ファイルを消す', async (_name, options) => {
    const { run, calls } = fakeCommands(options)
    const deployment = await createDeployment(run)
    await deployment.plan()
    await expect(deployment.migrate()).rejects.toThrow()
    await expect(deployment.apply()).rejects.toThrow()
    expect(existsSync(join(directory, 'database.value'))).toBe(false)
    expect(existsSync(join(directory, 'migration.env'))).toBe(false)
    expect(calls.some(({ args }) => args.includes('apply'))).toBe(false)
  })
  test('配備後に差分が残る場合は停止する', async () => {
    const { run } = fakeCommands({ postPlanDrift: true })
    const deployment = await createDeployment(run)
    await deployment.plan()
    await deployment.migrate()
    await expect(deployment.apply()).rejects.toThrow()
    expect(existsSync(join(directory, 'verified'))).toBe(false)
  })
  test.each([
    ['未認証で200', () => Response.json({ ok: true })],
    ['IAP認証拒否', (_url, options) => (!options.headers ? healthyIap(_url, options) : new Response(null, { status: 401 }))],
    ['アプリの異常応答', (_url, options) => (!options.headers ? healthyIap(_url, options) : Response.json({ ok: false }))],
  ])('%sなら古い保護タグを外さない', async (_name, fetcher) => {
    const { run, calls } = fakeCommands()
    const deployment = await createDeployment(run)
    await deployment.plan()
    await expect(deployment.verify(fetcher)).rejects.toThrow()
    await expect(deployment.cleanup()).rejects.toThrow()
    expect(calls.some(({ args }) => args.includes('delete'))).toBe(false)
  })
  test('prod workspaceを拒否する', async () => {
    process.env.TF_WORKSPACE = 'prod'
    await expect(createDeployment()).rejects.toThrow('dev以外')
  })
})

test('外部コマンドの失敗時に標準出力・エラー内の秘密値を表示しない', () => {
  expect(() => execute(process.execPath, ['-e', "process.stderr.write('secret-diagnostic'); process.exit(1)"])).toThrow('生出力は機密保護')
  try {
    execute(process.execPath, ['-e', "process.stdout.write('secret-diagnostic'); process.exit(1)"])
  } catch (error) {
    expect(error.message).not.toContain('secret-diagnostic')
  }
})
