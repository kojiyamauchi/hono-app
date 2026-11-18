import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as Bun from 'bun'

import { prepareClient } from './prepareClient.mjs'
import { prepareHashWasm } from './prepareHashWasm.mjs'
import { durableObjectConfig } from './prepareRemote.mjs'
import { verifyConcurrency } from './verifyConcurrency.mjs'

const directory = dirname(fileURLToPath(import.meta.url))
const root = resolve(directory, '../..')
const generatedDirectory = resolve(directory, '.wrangler')
const databaseEnabled = process.argv.includes('--database')
const optimized = process.argv.includes('--optimized')
const durable = process.argv.includes('--durable')
const modern = process.argv.includes('--modern')
const lean = process.argv.includes('--lean') || process.argv.includes('--lean-small')
const concurrencyEnabled = process.argv.includes('--concurrency')
const remoteUrl = process.env.CLOUDFLARE_SPIKE_URL
let token = remoteUrl ? process.env.CLOUDFLARE_SPIKE_TOKEN : crypto.randomUUID()
const accessHeaders =
  remoteUrl && process.env.CLOUDFLARE_SPIKE_ACCESS_CLIENT_ID && process.env.CLOUDFLARE_SPIKE_ACCESS_CLIENT_SECRET
    ? { 'CF-Access-Client-Id': process.env.CLOUDFLARE_SPIKE_ACCESS_CLIENT_ID, 'CF-Access-Client-Secret': process.env.CLOUDFLARE_SPIKE_ACCESS_CLIENT_SECRET }
    : {}
let worker
let containerName
let workerOutput = ''

/** 子プロセスの失敗を検出し、資格情報が含まれ得る出力は表示しない。 */
const command = (executable, args, options = {}) => {
  const result = spawnSync(executable, args, { cwd: root, encoding: 'utf8', ...options })
  if (result.status !== 0) throw new Error(`${executable} ${args[0]} の実行に失敗しました`)
  return result.stdout.trim()
}

/** 他のプロセスのポートを使用しないよう、空きポートを取得する。 */
const availablePort = async () => {
  const server = createServer()
  await new Promise((accept, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', accept)
  })
  const { port } = server.address()
  await new Promise((accept, reject) => server.close((error) => (error ? reject(error) : accept())))
  return port
}

/** 使い捨てDBの起動を待ち、今回作ったコンテナにだけmigrationを適用する。 */
const prepareDatabase = async () => {
  containerName = `hono-cloudflare-check-${crypto.randomUUID()}`
  command('docker', [
    'run',
    '--detach',
    '--rm',
    '--name',
    containerName,
    '--env',
    'POSTGRES_PASSWORD=cloudflare-local-check',
    '--publish',
    '127.0.0.1::5432',
    'postgres:17-alpine',
  ])
  let ready = false
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = spawnSync('docker', ['exec', containerName, 'pg_isready', '-U', 'postgres'], { stdio: 'ignore' })
    if (result.status === 0) {
      ready = true
      break
    }
    await Bun.sleep(250)
  }
  assert(ready, '検証用PostgreSQLが起動しませんでした')
  const address = command('docker', ['port', containerName, '5432/tcp'])
  assert.match(address, /^127\.0\.0\.1:\d+$/)
  const connectionString = `postgresql://postgres:cloudflare-local-check@${address}/postgres`
  command(process.execPath, ['x', '--no-install', 'prisma', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: connectionString } })
  return connectionString
}

/** 検証APIを呼び、本文に秘密値を表示せず結果だけを扱う。 */
const request = async (baseUrl, path, body, includeExecution = false) => {
  const started = performance.now()
  const response = await fetch(new URL(path, baseUrl), {
    method: body === undefined ? 'GET' : 'POST',
    redirect: 'error',
    headers: { ...accessHeaders, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })
  if (response.status !== 200) {
    // 応答本文を表示せず、診断に必要な既知のエラー番号だけを取り出す。
    const text = await response.text()
    const code = /\b(1102|P\d{4}|CHECK_FAILED)\b/.exec(text)?.[1]
    throw new Error(`${path} の検証APIが失敗しました (${response.status}${code ? `, ${code}` : ''})`)
  }
  const data = await response.json()
  return includeExecution
    ? {
        ...data,
        execution: {
          mode: response.headers.get('X-Spike-Execution-Mode'),
          activeAtStart: Number(response.headers.get('X-Spike-Active-Requests')),
          objectId: response.headers.get('X-Spike-Object-Id'),
          requestWallMs: Math.round(performance.now() - started),
        },
      }
    : data
}

try {
  assert(!concurrencyEnabled || (durable && databaseEnabled && !lean), '並行実行の比較は --database --durable と一緒に指定してください')
  if (remoteUrl && !token) {
    token = JSON.parse(await readFile(resolve(generatedDirectory, 'secrets.remote.json'), 'utf8')).SPIKE_TOKEN
  }
  assert(token, 'CLOUDFLARE_SPIKE_TOKENを設定してください')
  if (remoteUrl) {
    const url = new URL(remoteUrl)
    assert(
      url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash,
      '実環境は資格情報・クエリ・フラグメントなしのHTTPS URLを指定してください',
    )
    assert(Object.keys(accessHeaders).length === 2, '実環境検証にはCloudflare Accessの専用サービストークンを設定してください')
    // アプリ用の秘密値だけは渡し、AccessなしのWorker自身による401を入口保護と誤認しない。
    const denied = await fetch(new URL('/ready', remoteUrl), {
      headers: { authorization: `Bearer ${token}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    })
    assert([302, 401, 403].includes(denied.status), 'Cloudflare Accessによる入口制限を確認できませんでした')
  }
  await mkdir(generatedDirectory, { recursive: true })
  let baseUrl = remoteUrl
  if (!remoteUrl) {
    await prepareClient()
    await prepareHashWasm()
    const connectionString = databaseEnabled ? await prepareDatabase() : 'postgresql://postgres:postgres@127.0.0.1:1/unused'
    const config = JSON.parse(await readFile(resolve(directory, 'wrangler.json'), 'utf8'))
    config.main = resolve(
      directory,
      durable ? 'workerDurable.mjs' : lean ? (process.argv.includes('--lean-small') ? 'workerLeanSmall.mjs' : 'workerLean.mjs') : 'worker.mjs',
    )
    if (durable) Object.assign(config, durableObjectConfig)
    config.hyperdrive[0].localConnectionString = connectionString
    config.vars = { SPIKE_TOKEN: token, ENABLE_DATABASE_CHECK: String(databaseEnabled), PASSWORD_VERIFIER: modern ? 'modern' : optimized ? 'native' : 'legacy' }
    const configPath = resolve(generatedDirectory, 'wrangler.local.json')
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600 })
    const port = await availablePort()
    worker = spawn(
      'node',
      [
        resolve(directory, 'node_modules/wrangler/bin/wrangler.js'),
        'dev',
        '--local',
        '--config',
        configPath,
        '--ip',
        '127.0.0.1',
        '--port',
        String(port),
        '--inspector-port',
        '0',
        '--show-interactive-dev-session=false',
      ],
      {
        cwd: directory,
        env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: resolve(generatedDirectory, 'logs') },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    worker.stdout.on('data', (chunk) => {
      workerOutput = `${workerOutput}${chunk}`.slice(-16_384)
    })
    worker.stderr.on('data', (chunk) => {
      workerOutput = `${workerOutput}${chunk}`.slice(-16_384)
    })
    baseUrl = `http://127.0.0.1:${port}`
    let ready = false
    for (let attempt = 0; attempt < 120; attempt++) {
      if (worker.exitCode !== null || worker.signalCode !== null) throw new Error('Workers実行環境が終了しました')
      try {
        await request(baseUrl, '/ready')
        ready = true
        break
      } catch {
        await Bun.sleep(250)
      }
    }
    assert(ready, 'Workers実行環境が起動しませんでした')
  }
  const unauthorized = await fetch(new URL('/ready', baseUrl), { headers: accessHeaders, redirect: 'error' })
  assert.equal(unauthorized.status, 401, '未認証リクエストが拒否されませんでした')
  const cases = lean
    ? []
    : [
        ['ascii', 'Cloudflare-check-password-2026'],
        ['unicode', '日本語のパスワード🔐検証2026'],
        ['long', 'a'.repeat(256)],
        ['nul', 'password\u0000末尾を保持する'],
      ]
  const results = []
  const failures = []
  const parallel = []
  let concurrency = { skipped: true }
  // ハッシュのCPU上限の影響を分けるため、独立したDB接続検証を先に行う。
  let database = { skipped: true }
  let parallelDatabaseRequests = 0
  if (databaseEnabled) {
    try {
      const read = () => request(baseUrl, lean ? `/measure/database-row?sample=${crypto.randomUUID()}` : '/database', {})
      database = await read()
      if (optimized) {
        for (const kind of ['database-row', 'database-raw']) {
          const read = await request(baseUrl, `/measure/${kind}?sample=${crypto.randomUUID()}`, {})
          assert(read.ok && read.found === false, `${kind}: Prismaの単一取得が失敗しました`)
        }
      }
      const databaseResults = [database, ...(await Promise.all([read(), read()]))]
      for (const result of databaseResults) {
        if (lean) assert(result.ok && result.found === false, '読み取り専用Prismaの検証が失敗しました')
        else for (const [name, passed] of Object.entries(result)) assert.equal(passed, true, `DB確認に失敗しました: ${name}`)
      }
      parallelDatabaseRequests = 2
    } catch (error) {
      failures.push({ check: 'database', message: error.message })
    }
  }
  if (concurrencyEnabled) {
    concurrency = { skipped: false, batches: [] }
    try {
      const inputs = await Promise.all(cases.map(async ([, password]) => ({ password, bunHash: await Bun.password.hash(password) })))
      concurrency = await verifyConcurrency(
        (path, body) => request(baseUrl, path, body, true),
        inputs,
        optimized ? 'password-fast' : 'password',
        (batch) => concurrency.batches.push(batch),
      )
    } catch (error) {
      failures.push({ check: 'concurrency', message: error.message })
    }
  }
  try {
    for (const [name, password] of cases) {
      const bunHash = await Bun.password.hash(password)
      const started = performance.now()
      const path = optimized ? `/measure/password-fast?sample=${crypto.randomUUID()}` : '/password'
      const result = await request(baseUrl, path, { password, bunHash })
      const requestWallMs = Math.round(performance.now() - started)
      assert(result.verified, `${name}: Workersでの検証が失敗しました`)
      if (optimized) {
        const wrong = await request(baseUrl, path, { password: `${password}!incorrect`, bunHash })
        assert.equal(wrong.verified, false, `${name}: 不正解のパスワードを拒否できませんでした`)
      } else {
        assert(result.wrongPasswordRejected)
        assert(await Bun.password.verify(password, result.workerHash), `${name}: Bunでの検証が失敗しました`)
        assert.equal(await Bun.password.verify(`${password}!incorrect`, result.workerHash), false)
      }
      results.push({ name, bunToWorker: true, workerToBun: optimized ? 'generation-not-changed' : true, wrongPasswordRejected: true, requestWallMs })
    }
    // 初期化済みWasmの再利用と、複数リクエストの応答が混ざらないことを確認する。
    parallel.push(
      ...(await Promise.all(
        cases.slice(0, 2).map(async ([, password]) => {
          const path = optimized ? `/measure/password-fast?sample=${crypto.randomUUID()}` : '/password'
          const result = await request(baseUrl, path, { password, bunHash: await Bun.password.hash(password) })
          assert(result.verified && (optimized || (await Bun.password.verify(password, result.workerHash))))
          return true
        }),
      )),
    )
  } catch (error) {
    failures.push({ check: 'passwords', message: error.message })
  }
  const report = {
    runtime: remoteUrl ? 'cloudflare-remote' : 'local-workerd',
    bun: Bun.version,
    wrangler: JSON.parse(await readFile(resolve(directory, 'node_modules/wrangler/package.json'), 'utf8')).version,
    parameters: 'argon2id v=19 m=65536 t=2 p=1 salt=32 tag=32',
    optimized,
    durable,
    modern,
    lean,
    passwords: results,
    parallelRequests: parallel.length,
    database,
    databasePath: databaseEnabled ? (remoteUrl ? 'remote-hyperdrive' : 'local-hyperdrive-binding-direct-postgresql') : 'skipped',
    parallelDatabaseRequests,
    concurrency,
    failures,
  }
  await writeFile(resolve(generatedDirectory, 'result.json'), `${JSON.stringify(report, null, 2)}\n`)
  if (concurrencyEnabled)
    await writeFile(resolve(generatedDirectory, `concurrency-result.${remoteUrl ? 'remote' : 'local'}.json`), `${JSON.stringify(report, null, 2)}\n`, {
      mode: 0o600,
    })
  console.info(JSON.stringify(report, null, 2))
  if (failures.length) process.exitCode = 1
} catch (error) {
  // Wranglerのログはローカル生成物にだけ保存し、URL・資格情報を標準出力へ流さない。
  await writeFile(resolve(generatedDirectory, 'worker.log'), workerOutput, { mode: 0o600 }).catch(() => {})
  console.error(error.message)
  process.exitCode = 1
} finally {
  if (worker && worker.exitCode === null && worker.signalCode === null) {
    worker.kill('SIGTERM')
    await new Promise((accept) => worker.once('exit', accept))
  }
  if (containerName) {
    const stopped = spawnSync('docker', ['stop', '--time', '1', containerName], { stdio: 'ignore' })
    if (stopped.status !== 0) {
      console.error(`検証用コンテナを停止できませんでした: ${containerName}`)
      process.exitCode = 1
    }
  }
}
