import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { convertV4MiniflareOptions, Miniflare } from 'miniflare'
import pg from 'pg'

const directory = dirname(fileURLToPath(import.meta.url))
const root = resolve(directory, '../..')
let container
let runtime
let database

/** 資格情報を含み得る子プロセス出力を表示せず、成功だけを確認する。 */
const command = (program, args, options = {}) => {
  const result = spawnSync(program, args, { cwd: root, encoding: 'utf8', ...options })
  assert.equal(result.status, 0, `${program} ${args[0]} の実行に失敗しました`)
  return result.stdout.trim()
}

/** Bunの既存パスワード実装を別プロセスで呼び、workerdと相互検証する。 */
const bunPassword = (operation, input) =>
  JSON.parse(
    command('bun', ['--no-env-file', '-e', `const input = await Bun.stdin.json(); console.info(JSON.stringify(await Bun.password.${operation}(...input)))`], {
      input: JSON.stringify(input),
    }),
  )

try {
  container = `hono-app-workerd-${crypto.randomUUID()}`
  command('docker', [
    'run',
    '--detach',
    '--rm',
    '--name',
    container,
    '--env',
    'POSTGRES_PASSWORD=local-app-test',
    '--publish',
    '127.0.0.1::5432',
    'postgres:17-alpine',
  ])
  for (let attempt = 0; attempt < 80; attempt++) {
    if (spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'postgres'], { stdio: 'ignore' }).status === 0) break
    await new Promise((accept) => setTimeout(accept, 250))
  }
  const address = command('docker', ['port', container, '5432/tcp'])
  assert.match(address, /^127\.0\.0\.1:\d+$/)
  const connectionString = `postgresql://postgres:local-app-test@${address}/postgres`
  command('bun', ['x', '--no-install', 'prisma', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: connectionString } })
  database = new pg.Client({ connectionString })
  await database.connect()
  command('bun', ['scripts/cloudflare-app/prepare.mjs'])
  command('node', ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run', '--outdir', 'scripts/cloudflare-app/.wrangler/build'], {
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: resolve(directory, '.wrangler/logs') },
  })
  const productionBuild = resolve(directory, '.wrangler/build')
  let compressedBytes = 0
  for (const name of await readdir(productionBuild)) {
    if (name.endsWith('.js') || name.endsWith('.wasm')) compressedBytes += gzipSync(await readFile(resolve(productionBuild, name))).length
  }
  assert(compressedBytes < 3 * 1024 * 1024, '本体バンドルがFreeの3MiB上限を超えています')
  console.info(`本体バンドル圧縮合計: ${compressedBytes} bytes`)
  const config = JSON.parse(await readFile(resolve(root, 'wrangler.json'), 'utf8'))
  config.main = resolve(root, 'src/test/cloudflareHarness.ts')
  config.alias = { '@/generated/prisma/client': resolve(directory, '.wrangler/prisma/client.ts') }
  const configPath = resolve(directory, '.wrangler/test.json')
  const { writeFile } = await import('node:fs/promises')
  await writeFile(configPath, JSON.stringify(config))
  command(
    'node',
    ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run', '--config', configPath, '--outdir', resolve(directory, '.wrangler/test-build')],
    {
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: resolve(directory, '.wrangler/logs') },
    },
  )
  const build = resolve(directory, '.wrangler/test-build')
  const modules = [{ type: 'ESModule', path: resolve(build, 'cloudflareHarness.js'), contents: await readFile(resolve(build, 'cloudflareHarness.js'), 'utf8') }]
  for (const name of await readdir(build))
    if (name.endsWith('.wasm'))
      modules.push({ type: 'CompiledWasm', path: resolve(build, name), contents: new Uint8Array(await readFile(resolve(build, name))) })
  const issuer = 'https://local-app-test.cloudflareaccess.com'
  const audience = crypto.randomUUID()
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true })
  const jwk = { ...(await exportJWK(publicKey)), kid: 'local-test', alg: 'RS256', use: 'sig' }
  const accessToken = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'local-test' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey)
  const externalCalls = []
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'hono-app',
          modules,
          compatibilityDate: '2026-11-16',
          compatibilityFlags: ['nodejs_compat'],
          durableObjects: { APP_EXECUTOR: { className: 'AppExecutor', useSQLite: true }, PROBE: { className: 'ProbeExecutor', useSQLite: true } },
          hyperdrives: { HYPERDRIVE: connectionString },
          bindings: {
            ACCESS_ISSUER: issuer,
            ACCESS_AUDIENCE: audience,
            JWT_SECRET: 'local-app-test-jwt-secret-with-enough-entropy',
            REFRESH_TOKEN_SECRET: 'local-refresh-secret',
            PASSWORD_RESET_TOKEN_SECRET: 'local-reset-secret',
            EMAIL_VERIFICATION_TOKEN_SECRET: 'local-email-secret',
            SUPABASE_URL: 'https://local-supabase.example.invalid',
            SUPABASE_ANON_KEY: 'local-public-key',
            RESEND_API_KEY: 'local-resend-key',
            PASSWORD_RESET_FROM_EMAIL: 'test@example.invalid',
            PASSWORD_RESET_URL_BASE: 'https://app.example.invalid/reset',
            EMAIL_VERIFICATION_FROM_EMAIL: 'test@example.invalid',
            EMAIL_VERIFICATION_URL_BASE: 'https://app.example.invalid/verify',
            ALLOWED_ORIGINS: 'https://app.example.invalid',
            COOKIE_SECURE: 'true',
            ENABLE_API_DOCS: 'true',
            ENABLE_INVITATION_EMAIL: 'true',
            INVITATION_EMAIL_FROM: 'test@example.invalid',
            INVITATION_EMAIL_SCALAR_URL: 'https://app.example.invalid/open-api/scalar',
          },
          outboundService: async (request) => {
            const url = new URL(request.url)
            if (url.href === `${issuer}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] })
            externalCalls.push({ host: url.host, path: url.pathname })
            if (url.host === 'local-supabase.example.invalid') {
              const input = request.method === 'POST' ? await request.json() : {}
              if (input.email === 'success@example.invalid' || url.pathname === '/auth/v1/user') {
                const user = {
                  id: '00000000-0000-4000-8000-000000000001',
                  email: 'success@example.invalid',
                  aud: 'authenticated',
                  app_metadata: {},
                  user_metadata: {},
                  created_at: new Date().toISOString(),
                }
                return Response.json(
                  url.pathname === '/auth/v1/user'
                    ? user
                    : { user, access_token: 'synthetic-access-token', refresh_token: 'synthetic-refresh-token', token_type: 'bearer', expires_in: 3600 },
                )
              }
              return Response.json({ error: 'invalid_credentials', error_description: '検証用の認証失敗' }, { status: 400 })
            }
            if (url.host === 'api.resend.com') return Response.json({ id: crypto.randomUUID() })
            throw new Error('想定外の外部通信です')
          },
        },
      ],
    }),
  )
  /** 応答に個人情報やトークンを表示せず、statusと必要なbodyを内部で検証する。 */
  const request = async (path, { status = 200, token, cookie, body, method, access = accessToken, origin, ip = '192.0.2.1' } = {}) => {
    const headers = { 'content-type': 'application/json', 'cf-connecting-ip': ip }
    if (access) headers['cf-access-jwt-assertion'] = access
    if (token) headers.authorization = `Bearer ${token}`
    if (cookie) headers.cookie = cookie
    if (origin) headers.origin = origin
    const response = await runtime.dispatchFetch(`https://app.example.invalid${path}`, {
      method: method ?? (body ? 'POST' : 'GET'),
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })
    assert.equal(response.status, status, `${path}: 想定外のstatus (${response.status})`)
    return response
  }
  await request('/health', { access: '', status: 403 })
  await request('/health', { access: 'invalid', status: 403 })
  await request('/health')
  await request('/users/me', { status: 401 })
  const spec = await (await request('/open-api/doc')).json()
  assert(spec.paths['/auth/login'] && spec.paths['/supabase-auth/login'] && spec.paths['/organizations/{id}/projects'])
  await request('/open-api/scalar')
  const cors = await request('/auth/login', { method: 'OPTIONS', origin: 'https://app.example.invalid', status: 204 })
  assert.equal(cors.headers.get('access-control-allow-origin'), 'https://app.example.invalid')
  await request('/auth/login', { body: { email: 'test@example.invalid', password: 'invalid' }, origin: 'https://untrusted.example.invalid', status: 403 })
  console.info('Access・全feature登録・Bearer必須・CORS・Origin: 成功')

  const transaction = await (await request('/_test/probe', { body: { operation: 'transaction', sample: crypto.randomUUID() } })).json()
  assert.deepEqual(transaction, { locked: true, rolledBack: true, unique: true, cleaned: true })
  const samples = Array.from({ length: 4 }, () => crypto.randomUUID())
  const intervals = await Promise.all(samples.map(async (sample) => (await request('/_test/probe', { body: { operation: 'wait', sample } })).json()))
  assert.deepEqual(
    intervals.map((item) => item.sample),
    samples,
  )
  assert(Math.max(...intervals.map((item) => item.interval.started)) < Math.min(...intervals.map((item) => item.interval.finished)), 'DB待ちが重複していません')
  console.info('同一ObjectでのI/O重複・環境/接続分離・FOR UPDATE・rollback・P2002: 成功')

  const passwordCases = ['Cloudflare-password-2026', '日本語と絵文字🔐Password', 'a'.repeat(256), 'pass\0word2026']
  const bunHashes = passwordCases.map((password) => bunPassword('hash', [password]))
  const concurrentHashes = await Promise.all(
    passwordCases.map(async (password, index) =>
      (await request('/_test/probe', { body: { operation: 'password', sample: crypto.randomUUID(), password, hash: bunHashes[index] } })).json(),
    ),
  )
  for (const [index, result] of concurrentHashes.entries()) {
    assert.equal(result.verified, true)
    assert.equal(bunPassword('verify', [passwordCases[index], result.hash]), true)
  }
  const users = []
  for (const [index, password] of passwordCases.entries()) {
    const email = `workerd-${crypto.randomUUID()}@example.invalid`
    const hash = bunHashes[index]
    const saved = await database.query('INSERT INTO "User" (name,email,password,"updatedAt") VALUES ($1,$2,$3,now()) RETURNING id', [
      `既存Bunハッシュ${index}`,
      email,
      hash,
    ])
    const response = await request('/auth/login', { body: { email, password }, ip: `192.0.2.${index + 10}` })
    const data = await response.json()
    assert.equal(data.user.id, saved.rows[0].id)
    const cookie = response.headers.get('set-cookie')
    assert(cookie.includes('HttpOnly') && cookie.includes('Secure') && cookie.includes('SameSite=Lax'))
    users.push({ ...data, email, password, cookie: cookie.split(';')[0] })
    await request('/auth/login', { body: { email, password: `${password}!wrong` }, status: 401, ip: `192.0.2.${index + 20}` })
  }
  const signupEmail = `workerd-signup-${crypto.randomUUID()}@example.invalid`
  const signed = await (
    await request('/auth/signup', { status: 201, body: { name: 'Workers新規登録', email: signupEmail, password: passwordCases[0] }, ip: '192.0.2.90' })
  ).json()
  const savedHash = await database.query('SELECT password FROM "User" WHERE email=$1', [signupEmail])
  assert.match(savedHash.rows[0].password, /^\$argon2id\$v=19\$m=65536,t=2,p=1\$/)
  assert.equal(bunPassword('verify', [passwordCases[0], savedHash.rows[0].password]), true)
  const owner = users[0]
  const other = users[1]
  const verificationToken = crypto.randomUUID()
  await database.query('INSERT INTO "EmailVerificationToken" ("userId","tokenHash","expiresAt") VALUES ($1,$2,now()+interval \'1 hour\')', [
    owner.user.id,
    createHmac('sha256', 'local-email-secret').update(verificationToken).digest('hex'),
  ])
  await request('/auth/email-verification/confirm', { body: { token: verificationToken }, status: 204 })
  const organization = await (await request('/organizations', { status: 201, token: owner.token, body: { name: 'workerd検証組織' } })).json()
  await request(`/organizations/${organization.id}`, { token: other.token, status: 404 })
  const project = await (
    await request(`/organizations/${organization.id}/projects`, { status: 201, token: owner.token, body: { name: '検証プロジェクト' } })
  ).json()
  await request(`/organizations/${organization.id}/projects/${project.id}`, { token: owner.token })
  const invitationEmail = `workerd-invitation-${crypto.randomUUID()}@example.invalid`
  const invitation = await (
    await request(`/organizations/${organization.id}/invitations`, { token: owner.token, body: { email: invitationEmail, role: 'MEMBER' }, status: 201 })
  ).json()
  const invited = await (
    await request('/invitations/signup', { body: { token: invitation.invitationToken, name: '招待検証', password: passwordCases[0] }, status: 201 })
  ).json()
  const delivery = await database.query('SELECT count(*)::int AS count FROM "InvitationEmailDelivery" WHERE "invitationId"=$1', [invitation.id])
  assert.equal(delivery.rows[0].count, 1)
  await request(`/organizations/${organization.id}`, { token: invited.token })
  await request('/users/me', { token: invited.token, method: 'DELETE', body: { currentPassword: passwordCases[0] }, status: 204 })
  const parallel = await Promise.all(users.map(async (user) => (await request('/users/me', { token: user.token })).json()))
  assert.deepEqual(
    parallel.map((user) => user.id),
    users.map((user) => user.user.id),
  )
  const refreshed = await request('/auth/refresh', { method: 'POST', cookie: owner.cookie })
  const refreshedCookie = refreshed.headers.get('set-cookie').split(';')[0]
  await request('/auth/refresh', { method: 'POST', cookie: owner.cookie, status: 401 })
  await request('/auth/refresh', { method: 'POST', cookie: refreshedCookie, status: 401 })
  await request('/auth/change-password', {
    status: 204,
    token: other.token,
    body: { currentPassword: other.password, newPassword: 'Changed-workerd-password2026' },
  })
  const changed = await database.query('SELECT password FROM "User" WHERE id=$1', [other.user.id])
  assert.equal(bunPassword('verify', ['Changed-workerd-password2026', changed.rows[0].password]), true)
  await request('/supabase-auth/login', { body: { email: 'test@example.invalid', password: 'password12345' }, status: 401 })
  await request('/auth/password-reset/request', { body: { email: owner.email }, status: 202 })
  for (const path of ['/supabase-auth/signup', '/supabase-auth/login']) {
    const response = await (
      await request(path, { body: { email: 'success@example.invalid', password: 'password12345' }, status: path.endsWith('signup') ? 201 : 200 })
    ).json()
    assert.equal(response.token, 'synthetic-access-token')
  }
  await request('/supabase-auth/me', { token: 'synthetic-access-token' })
  const resetToken = crypto.randomUUID()
  await database.query('UPDATE "PasswordResetToken" SET "tokenHash"=$1 WHERE "userId"=$2', [
    createHmac('sha256', 'local-reset-secret').update(resetToken).digest('hex'),
    owner.user.id,
  ])
  await request('/auth/password-reset/confirm', { body: { token: resetToken, password: 'Reset-workerd-password2026' }, status: 204 })
  const resetHash = await database.query('SELECT password FROM "User" WHERE id=$1', [owner.user.id])
  assert.equal(bunPassword('verify', ['Reset-workerd-password2026', resetHash.rows[0].password]), true)
  assert(externalCalls.some((call) => call.host === 'local-supabase.example.invalid'))
  assert(externalCalls.some((call) => call.host === 'api.resend.com'))
  assert(signed.user.id)
  console.info(
    'Bun既存ハッシュ4ケース・誤照合拒否・Workers生成ハッシュのBun照合・変更・Cookieローテーション/再利用失効・組織権限・Prisma読み書き・4並行リクエスト・外部SDK境界: 成功',
  )

  await new Promise((accept) => setTimeout(accept, 100))
  const connections = await database.query(
    "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'",
  )
  assert.equal(connections.rows[0].count, 0, 'リクエスト後にDB接続が残っています')
  await database.query('DELETE FROM "InvitationEmailDelivery"')
  await database.query('DELETE FROM "Invitation"')
  await database.query('DELETE FROM "AuditLog"')
  await database.query('DELETE FROM "Project"')
  await database.query('DELETE FROM "Membership"')
  await database.query('DELETE FROM "Organization"')
  await database.query('DELETE FROM "User"')
  const remaining = await database.query('SELECT count(*)::int AS count FROM "User"')
  assert.equal(remaining.rows[0].count, 0)
  console.info('接続解放・専用DB内の検証データ削除: 成功')
} finally {
  await runtime?.dispose()
  await database?.end()
  if (container) command('docker', ['stop', container])
}
