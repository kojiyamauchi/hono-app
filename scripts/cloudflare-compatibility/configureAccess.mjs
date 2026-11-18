import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** 手動発行した検証用トークンだけを選び、無効・期限切れ・重複を拒否する。 */
export const selectVerificationToken = (tokens, clientId, now = Date.now()) => {
  const matches = tokens.filter(({ name }) => name === 'hono-app-dev-verification')
  assert.equal(matches.length, 1, 'hono-app-dev-verificationという名前のサービストークンを1件作成してください')
  const token = matches[0]
  assert.match(token.id, /^[0-9a-f-]{36}$/, 'サービストークンの管理用IDが不正です')
  assert.equal(token.client_id, clientId, 'ローカルのClient IDが検証用サービストークンと一致しません')
  assert.notEqual(token.enabled, false, 'サービストークンが無効です')
  assert(Date.parse(token.expires_at) > now, 'サービストークンが期限切れです')
  return token.id
}

/** Cloudflareの既存設定を読み取り、秘密値を含めずローカルtfvarsのIDだけを補完する。 */
const main = async () => {
  assert(process.env.CLOUDFLARE_API_TOKEN, 'CLOUDFLARE_API_TOKENをローカル環境ファイルへ設定してください')
  assert(
    process.env.CLOUDFLARE_SPIKE_ACCESS_CLIENT_ID && process.env.CLOUDFLARE_SPIKE_ACCESS_CLIENT_SECRET,
    'AccessのClient ID・Client Secretをローカル環境ファイルへ設定してください',
  )
  const path = resolve(root, 'infra/cloudflare/env/dev.local.tfvars')
  let values = await readFile(path, 'utf8')
  const accountId = /^account_id\s*=\s*"([0-9a-f]{32})"\s*$/m.exec(values)?.[1]
  assert(accountId, 'dev.local.tfvarsのaccount_idを確認してください')
  const get = async (endpoint) => {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/${endpoint}`, {
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    })
    assert(response.ok, `Cloudflare設定の読み取りに失敗しました (${response.status})。APIトークンの権限とZero Trustの初期設定を確認してください`)
    const data = await response.json()
    assert(data.success, 'Cloudflare設定の読み取りが成功しませんでした')
    assert(
      !data.result_info || ((data.result_info.total_pages ?? 1) <= 1 && (data.result_info.total_count ?? data.result.length) <= data.result.length),
      '複数ページの設定があります。IDの選択を個別に確認してください',
    )
    return data.result
  }
  const [identityProviders, tokens] = await Promise.all([get('access/identity_providers?per_page=100'), get('access/service_tokens?per_page=100')])
  const otpProviders = identityProviders.filter(({ type }) => type === 'onetimepin')
  assert(otpProviders.length <= 1, 'One-time PINが複数あります。再利用するIDを個別に確認してください')
  const tokenId = selectVerificationToken(tokens, process.env.CLOUDFLARE_SPIKE_ACCESS_CLIENT_ID)
  const otpId = otpProviders[0]?.id ?? null
  assert(otpId === null || /^[0-9a-f-]{36}$/.test(otpId), '既存One-time PINのIDが不正です')
  for (const [name, value] of [
    ['access_service_token_id', tokenId],
    ['existing_otp_identity_provider_id', otpId],
  ]) {
    const line = new RegExp(`^${name}\\s*=\\s*(null|"[0-9a-f-]{36}")\\s*$`, 'm')
    assert(line.test(values), `${name}の設定形式を確認してください`)
    values = values.replace(line, `${name} = ${JSON.stringify(value)}`)
  }
  await writeFile(path, values, { mode: 0o600 })
  console.info('既存OTPと手動発行済みサービストークンのIDを、Git管理外のtfvarsへ設定しました')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
