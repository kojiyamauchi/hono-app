import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deployCloudflare, isCurrentCloudflareSha } from '../cloudflare-cd.mjs'
import { appSecretsFixture, protectionFixture } from './cloudflare-cd-fixtures.js'

/** 配備の境界に失敗を差し込み、変更前停止と変更後の情報保持を観測する。 */
async function deploymentFixture(fail = '') {
  const directory = await mkdtemp(join(tmpdir(), 'hono-cloudflare-cd-'))
  const events = []
  let checks = 0
  let activeCalls = 0
  const parameters = {
    config: protectionFixture()[0],
    secrets: appSecretsFixture(),
    sha: 'a'.repeat(40),
    directory,
    credentials: { id: 'test', secret: 'test' },
    databaseUrl: 'test',
    summaryPath: join(directory, 'summary.md'),
  }
  const event = (name) => {
    events.push(name)
    if (name === fail) throw new Error('test failure')
  }
  const dependencies = {
    api: async () => {},
    run: (command, args) => {
      if (command === 'git') {
        checks++
        return `${fail === `outdated-${checks}` ? 'b'.repeat(40) : parameters.sha}\trefs/heads/main`
      }
      event(args.includes('--secrets-file') ? 'upload' : args.includes('--dry-run') ? 'build' : 'prepare')
      return ''
    },
    infrastructure: async () => {
      event('infrastructure')
      return {}
    },
    database: async () => {
      event('database')
    },
    active: async (_config, _api, sha) => {
      event(sha ? 'active-new' : 'active-old')
      activeCalls++
      return sha ? 'new-version' : 'old-version'
    },
    http: async () => {
      event('http')
    },
  }
  return {
    parameters,
    dependencies,
    events,
    directory,
    get activeCalls() {
      return activeCalls
    },
  }
}

test('配備は保護・DB検証後にだけ更新し、前versionを残しSecretを削除する', async () => {
  const f = await deploymentFixture()
  try {
    const result = await deployCloudflare(f.parameters, f.dependencies)
    expect(result).toEqual({ sha: 'a'.repeat(40), previous: 'old-version', current: 'new-version' })
    expect(f.events).toEqual([
      'infrastructure',
      'database',
      'active-old',
      'prepare',
      'build',
      'infrastructure',
      'database',
      'upload',
      'active-new',
      'infrastructure',
      'http',
      'active-new',
    ])
    expect((await stat(join(f.directory, 'release.json'))).mode & 0o777).toBe(0o600)
    await expect(stat(join(f.directory, 'secrets.json'))).rejects.toThrow()
    expect(await readFile(f.parameters.summaryPath, 'utf8')).toContain('old-version')
  } finally {
    await rm(f.directory, { recursive: true, force: true })
  }
})

for (const failure of ['infrastructure', 'database', 'active-old', 'prepare', 'build', 'upload', 'active-new', 'http'])
  test(`${failure}失敗時に後続を実行せず秘密値を削除する`, async () => {
    const f = await deploymentFixture(failure)
    try {
      await expect(deployCloudflare(f.parameters, f.dependencies)).rejects.toThrow()
      expect(f.events.at(-1)).toBe(failure)
      await expect(stat(join(f.directory, 'secrets.json'))).rejects.toThrow()
      if (['upload', 'active-new', 'http'].includes(failure)) expect(await readFile(f.parameters.summaryPath, 'utf8')).toContain('old-version')
      else expect(f.events).not.toContain('upload')
    } finally {
      await rm(f.directory, { recursive: true, force: true })
    }
  })

for (const check of [1, 2])
  test(`第${check}回のSHA確認で古くなれば配備を省略する`, async () => {
    const f = await deploymentFixture(`outdated-${check}`)
    try {
      expect(await deployCloudflare(f.parameters, f.dependencies)).toBe('outdated')
      expect(f.events).not.toContain('upload')
    } finally {
      await rm(f.directory, { recursive: true, force: true })
    }
  })

test('初回配備はURL無効だけを許可し、既存versionとHTTP検証を要求しない', async () => {
  const f = await deploymentFixture()
  try {
    f.parameters.bootstrap = true
    await expect(deployCloudflare(f.parameters, f.dependencies)).rejects.toThrow()
    f.parameters.config.enable_worker_url = false
    expect((await deployCloudflare(f.parameters, f.dependencies)).previous).toBeNull()
    expect(f.events).not.toContain('active-old')
    expect(f.events).not.toContain('http')
  } finally {
    await rm(f.directory, { recursive: true, force: true })
  }
})

test('mainの読み取り失敗・不正応答を配備許可として扱わない', () => {
  expect(() => isCurrentCloudflareSha('a'.repeat(40), () => '')).toThrow()
  expect(() =>
    isCurrentCloudflareSha('a'.repeat(40), () => {
      throw new Error('network')
    }),
  ).toThrow()
})
