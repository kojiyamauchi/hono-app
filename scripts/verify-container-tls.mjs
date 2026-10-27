import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { connect, createServer } from 'node:tls'

import { verifySupabaseCa } from './verify-certificate.mjs'

const caPath = process.env.NODE_EXTRA_CA_CERTS
assert.ok(caPath, '追加CAの読み込み先が設定されていません')
assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0', '証明書検証が無効です')
verifySupabaseCa(caPath)

const fixtureDirectory = process.argv[2]
assert.ok(fixtureDirectory, '検証用証明書のディレクトリが必要です')
const cert = readFileSync(join(fixtureDirectory, 'server.crt'))
const server = createServer({ key: readFileSync(join(fixtureDirectory, 'server.key')), cert }, (socket) => socket.end())
await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})
const address = server.address()
assert.ok(address && typeof address !== 'string')

/** 検証用TLSサーバーへの接続結果を返す。 */
const connectToFixture = (options = {}) =>
  new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port: address.port, servername: 'localhost', ...options })
    socket.once('secureConnect', () => {
      socket.end()
      resolve()
    })
    socket.once('error', reject)
    socket.setTimeout(5000, () => socket.destroy(new Error('TLS接続がタイムアウトしました')))
  })

try {
  // 正しいCAを指定した接続が成立することを確認してから、拒否ケースを検証する。
  await connectToFixture({ ca: cert })
  await assert.rejects(connectToFixture(), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' })
  await assert.rejects(connectToFixture({ ca: cert, servername: 'wrong.invalid' }), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' })
  // 起動時の追加CA読み込みを、caを明示しない子プロセスの接続で検証する。
  const probe = `import { connect } from 'node:tls'
const socket = connect({ host: '127.0.0.1', port: ${address.port}, servername: 'localhost' })
socket.once('secureConnect', () => { socket.end(); process.exit(0) })
socket.once('error', (error) => { console.error(error.code ?? error.message); process.exit(1) })
socket.setTimeout(5000, () => socket.destroy(new Error('TLS接続がタイムアウトしました')))`
  const status = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', probe], {
      env: { ...process.env, NODE_EXTRA_CA_CERTS: join(fixtureDirectory, 'server.crt') },
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    child.once('error', reject)
    child.once('exit', resolve)
  })
  assert.equal(status, 0, '追加CAが既定の信頼ストアへ反映されていません')
  console.info('TLS検証成功: 追加CAの信頼ストア反映、Supabase公開CAの同梱、未知のCAと異なるホスト名の拒否')
} finally {
  await new Promise((resolve) => server.close(resolve))
}
