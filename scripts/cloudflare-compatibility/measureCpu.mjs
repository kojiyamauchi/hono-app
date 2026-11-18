import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as Bun from 'bun'

const directory = dirname(fileURLToPath(import.meta.url))
const generatedDirectory = resolve(directory, '.wrangler')

/** 分割・連結されたJSONログを順に読み、元のログを外へ渡さず整形する。 */
export const createTraceConsumer = (samples, accept) => {
  let buffer = ''
  return (chunk) => {
    buffer += chunk.toString()
    let depth = 0
    let quoted = false
    let escaped = false
    let start = -1
    let consumed = 0
    for (let index = 0; index < buffer.length; index++) {
      const character = buffer[index]
      if (start < 0) {
        if (character !== '{') continue
        start = index
      }
      if (quoted) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === '"') quoted = false
        continue
      }
      if (character === '"') quoted = true
      else if (character === '{') depth++
      else if (character === '}') depth--
      if (depth !== 0) continue
      try {
        const trace = summarizeTrace(JSON.parse(buffer.slice(start, index + 1)), samples)
        if (trace) accept(trace)
      } catch {
        // 診断以外のJSONや不正なログは表示しない。
      }
      consumed = index + 1
      start = -1
    }
    buffer = buffer.slice(consumed)
    assert(buffer.length < 2_000_000, '診断ログのサイズ上限に達しました')
  }
}

/** tailの資格情報・IP・本文を捨て、今回の計測に必要な項目だけを残す。 */
export const summarizeTrace = (trace, samples) => {
  const urlSample = new URL(trace.event?.request?.url ?? 'https://invalid.example').searchParams.get('sample')
  const metadata = trace.logs
    ?.flatMap(({ message }) => message ?? [])
    .map((entry) => {
      if (typeof entry !== 'string') return entry
      try {
        return JSON.parse(entry)
      } catch {
        return null
      }
    })
    .find((entry) => samples.has(entry?.cpuMeasurement?.sample))?.cpuMeasurement
  const sample = samples.has(urlSample) ? urlSample : metadata?.sample
  if (!samples.has(sample)) return null
  return {
    sample,
    outcome: trace.outcome,
    cpuMs: Number.isFinite(trace.cpuTime) ? trace.cpuTime : null,
    wallMs: Number.isFinite(trace.wallTime) ? trace.wallTime : null,
    versionId: trace.scriptVersion?.id ?? null,
    isolateId: metadata?.isolateId ?? null,
    operationIndex: metadata?.operationIndex ?? null,
    ...(metadata?.scope ? { scope: metadata.scope } : {}),
  }
}

/** 実Workerで単一操作を計測し、待ち時間ではなくCloudflare計測のCPU時間を記録する。 */
const main = async () => {
  const databaseRowOnly = process.argv.includes('--database-row-only')
  const optimized = process.argv.includes('--optimized')
  const passwordOnly = process.argv.includes('--password-only')
  const config = JSON.parse(await readFile(resolve(generatedDirectory, 'wrangler.remote.json'), 'utf8'))
  const runtimeProfile = config.main.includes('Durable')
    ? 'durable'
    : config.main.includes('LeanSmall')
      ? 'lean-small'
      : config.main.includes('Lean')
        ? 'lean-fast'
        : 'standard'
  if (optimized) assert.equal(config.vars.PASSWORD_VERIFIER, 'native', '比較計測はCLOUDFLARE_SPIKE_PASSWORD_VERIFIER=nativeを指定した配備後に実行してください')
  assert(process.env.CLOUDFLARE_API_TOKEN, 'Cloudflare APIトークンが必要です')
  assert(process.env.CLOUDFLARE_SPIKE_ACCESS_CLIENT_ID && process.env.CLOUDFLARE_SPIKE_ACCESS_CLIENT_SECRET, 'Accessの資格情報が必要です')
  const baseUrl = new URL(process.env.CLOUDFLARE_SPIKE_URL)
  assert(
    baseUrl.protocol === 'https:' && !baseUrl.username && !baseUrl.password && !baseUrl.search && !baseUrl.hash,
    '資格情報を含まないHTTPS Originを指定してください',
  )
  assert(baseUrl.hostname.startsWith(`${config.name}.`) && baseUrl.hostname.endsWith('.workers.dev'), '検証WorkerのURLを確認してください')
  const spikeToken = process.env.CLOUDFLARE_SPIKE_TOKEN || JSON.parse(await readFile(resolve(generatedDirectory, 'secrets.remote.json'), 'utf8')).SPIKE_TOKEN
  const headers = {
    'CF-Access-Client-Id': process.env.CLOUDFLARE_SPIKE_ACCESS_CLIENT_ID,
    'CF-Access-Client-Secret': process.env.CLOUDFLARE_SPIKE_ACCESS_CLIENT_SECRET,
    authorization: `Bearer ${spikeToken}`,
    'content-type': 'application/json',
  }
  // 配備直後の旧Versionを測定しないよう、選択した構成の応答を待つ。
  let deployed = false
  for (let attempt = 0; attempt < 15; attempt++) {
    const response = await fetch(new URL('/ready', baseUrl), { headers, redirect: 'error', signal: AbortSignal.timeout(10_000) })
    const ready = response.status === 200 ? await response.json() : {}
    deployed = ['standard', 'durable'].includes(runtimeProfile)
      ? ready.profile === runtimeProfile && ready.passwordVerifier === config.vars.PASSWORD_VERIFIER
      : ready.profile === 'lean' && ready.compilerBuild === (runtimeProfile === 'lean-small' ? 'small' : 'fast')
    if (deployed) break
    await Bun.sleep(500)
  }
  assert(deployed, '選択したWorker構成の反映を確認できませんでした')
  // 合成パスワードの生成・Bun側のハッシュ計算はWorkerのCPU計測外で行う。
  const password = 'Cloudflare-single-verification-2026'
  const body = { password, bunHash: await Bun.password.hash(password) }
  const samples = new Set()
  const traces = new Map()
  const executor = crypto.randomUUID()
  const results = []
  const tail = spawn(
    'node',
    [
      resolve(directory, 'node_modules/wrangler/wrangler-dist/cli.js'),
      'tail',
      '--config',
      resolve(generatedDirectory, 'wrangler.remote.json'),
      '--format=json',
    ],
    {
      cwd: directory,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: resolve(generatedDirectory, 'cpu-logs') },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  const consume = createTraceConsumer(samples, (summary) => traces.set(`${summary.sample}:${summary.scope ?? 'worker'}`, summary))
  tail.stdout.on('data', consume)
  // CLIのエラー本文にはURLなどが含まれ得るため、終了コードだけを扱う。
  tail.stderr.on('data', () => {})
  const exited = new Promise((accept) => tail.once('exit', accept))
  try {
    await Bun.sleep(3000)
    const operations = optimized
      ? ['ready', ...Array(5).fill('database-raw'), ...Array(5).fill('database-row'), ...Array(5).fill('password-fast')]
      : passwordOnly
        ? ['ready', ...Array(5).fill('password')]
        : databaseRowOnly
          ? ['ready', ...Array(5).fill('database-row')]
          : ['ready', ...Array(5).fill('database'), ...Array(5).fill('password')]
    for (const kind of operations) {
      assert(tail.exitCode === null, 'tailが終了しました。Cloudflareの認証・接続を確認してください')
      const sample = crypto.randomUUID()
      samples.add(sample)
      const url = new URL(`/measure/${kind}`, baseUrl)
      url.searchParams.set('sample', sample)
      if (runtimeProfile === 'durable') url.searchParams.set('executor', executor)
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(kind.startsWith('password') ? body : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      })
      let found
      if (response.status === 200) {
        const data = await response.json()
        assert(kind.startsWith('password') ? data.verified === true : data.ok === true, '単一操作の結果が不正です')
        if (kind === 'database' || kind === 'database-raw') assert.equal(data.found, false, '合成メールアドレスが既存データと衝突しました')
        if (kind.startsWith('database')) found = data.found
      } else {
        // CloudflareのHTML本文などをレポートに混ぜない。
        await response.arrayBuffer()
      }
      const deadline = Date.now() + (kind === 'ready' ? 3000 : 15_000)
      while ((!traces.has(`${sample}:worker`) || (runtimeProfile === 'durable' && !traces.has(`${sample}:durable-object`))) && Date.now() < deadline)
        await Bun.sleep(100)
      const result = {
        kind,
        status: response.status,
        completed: response.status === 200,
        ...(found === undefined ? {} : { found }),
        ...(traces.get(`${sample}:worker`) ?? { sample, outcome: 'trace-missing', cpuMs: null, wallMs: null }),
        ...(runtimeProfile === 'durable' ? { executor: traces.get(`${sample}:durable-object`) ?? { outcome: 'trace-missing', cpuMs: null } } : {}),
      }
      results.push(result)
      console.info(JSON.stringify(result))
    }
    const report = {
      recordedAt: new Date().toISOString(),
      runtime: 'cloudflare-remote',
      runtimeProfile,
      passwordParameters: 'argon2id v=19 m=65536 t=2 p=1 salt=32 tag=32',
      passwordImplementation:
        config.vars.PASSWORD_VERIFIER === 'modern'
          ? 'hash-wasm 4.12.0、静的Wasm、既存と同一パラメーター'
          : optimized
            ? 'argon2-browser 1.18.0 SIMD、静的Wasm、C実装のverify_ext'
            : 'argon2id 1.0.1 SIMD、JSでの制御ループ',
      databaseQuery: optimized
        ? 'User.findFirstとPrisma.$queryRawのパラメーター化した一意検索を比較。各リクエスト1 SQL、書き込みなし'
        : databaseRowOnly
          ? 'User.findFirst(): select id、取得1回、実値を出力しない、書き込みなし'
          : 'User.findUnique(email): select id、存在しない合成メールアドレス、1 SQL、書き込みなし',
      cpuScope: 'HTTP認証・入力変換・単一操作・応答処理を含む。DBはPrismaクライアント作成と切断も含む。',
      results,
    }
    await writeFile(
      resolve(
        generatedDirectory,
        runtimeProfile !== 'standard'
          ? `cpu-result.${runtimeProfile}.${config.vars.PASSWORD_VERIFIER}${databaseRowOnly ? '.database-row' : passwordOnly ? '.password' : ''}.json`
          : optimized
            ? 'cpu-result.optimized.json'
            : databaseRowOnly
              ? 'cpu-result.database-row.json'
              : 'cpu-result.json',
      ),
      `${JSON.stringify(report, null, 2)}\n`,
      {
        mode: 0o600,
      },
    )
    assert(
      results
        .filter(({ kind }) => kind !== 'ready')
        .every(({ outcome, cpuMs, executor }) => outcome !== 'trace-missing' && cpuMs !== null && (runtimeProfile !== 'durable' || executor?.cpuMs !== null)),
      '計測対象のCPU診断を取得できませんでした',
    )
  } finally {
    if (tail.exitCode === null) {
      tail.kill('SIGINT')
      await Promise.race([exited, Bun.sleep(5000)])
      if (tail.exitCode === null) {
        tail.kill('SIGKILL')
        await exited
      }
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
