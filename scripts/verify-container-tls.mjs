import assert from 'node:assert/strict'
import { X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { connect, createServer } from 'node:tls'

const caPath = process.env.NODE_EXTRA_CA_CERTS
assert.ok(caPath, '追加CAの読み込み先が設定されていません')
assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0', '証明書検証が無効です')
const root = new X509Certificate(readFileSync(caPath))
assert.equal(root.ca, true)
assert.equal(root.fingerprint256, '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA')
assert.ok(Date.parse(root.validTo) - Date.now() > 90 * 24 * 60 * 60 * 1000, 'CA証明書の更新が必要です')

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
  console.info('TLS検証成功: Supabase公開CAの同梱、未知のCAと異なるホスト名の拒否')
} finally {
  await new Promise((resolve) => server.close(resolve))
}
