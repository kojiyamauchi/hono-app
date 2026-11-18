import assert from 'node:assert/strict'

import { assertCloudflareProtection } from './cloudflare-cd-policy.mjs'

/** API本文や例外を公開せず、リダイレクトと無期限待機を拒否する。 */
export function cloudflareApi(config, token, request = fetch) {
  assert(token)
  return async (path) => {
    const response = await request(`https://api.cloudflare.com/client/v4/accounts/${config.account_id}/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    })
    assert(response.ok)
    const body = await response.json()
    assert.equal(body.success, true)
    return body.result
  }
}

/** 配備前後に同じ保護設定とHyperdriveの接続安全性を読み取り確認する。 */
export async function verifyCloudflareInfrastructure(config, api) {
  const application = await api(`access/apps/${config.access_application_id}`)
  const policies = await Promise.all(config.access_policy_ids.map((id) => api(`access/policies/${id}`)))
  const organization = await api('access/organizations')
  const subdomain = await api(`workers/scripts/${config.worker_name}/subdomain`)
  assertCloudflareProtection(config, application, policies, organization, subdomain)
  const accountSubdomain = await api('workers/subdomain')
  assert.equal(config.origin, `https://${config.worker_name}.${accountSubdomain.subdomain}.workers.dev`)
  const hyperdrive = await api(`hyperdrive/configs/${config.hyperdrive_id}`)
  assert.equal(hyperdrive.caching?.disabled, true)
  assert.equal(hyperdrive.origin?.scheme, 'postgres')
  assert.equal(hyperdrive.mtls?.sslmode, 'verify-full')
  assert(hyperdrive.mtls?.ca_certificate_id)
  return hyperdrive.origin
}

/** 新バージョンが100%のトラフィックを受け、ソースSHAと一致することを確認する。 */
export async function activeCloudflareVersion(config, api, sha) {
  const result = await api(`workers/scripts/${config.worker_name}/deployments`)
  const deployment = result.deployments?.[0]
  assert.equal(deployment?.versions?.length, 1)
  assert.equal(deployment.versions[0].percentage, 100)
  const id = deployment.versions[0].version_id
  assert.match(id, /^[a-f0-9-]{36}$/)
  if (sha) {
    const version = await api(`workers/scripts/${config.worker_name}/versions/${id}`)
    assert.equal(version.metadata?.annotations?.['workers/tag'], sha)
  }
  return id
}

/** Accessなしの全代表パスの拒否と、Access通過後のhealth・アプリBearer必須を確認する。 */
export async function verifyCloudflareHttp(config, credentials, request = fetch) {
  assert(config.enable_worker_url)
  assert(credentials.id && credentials.secret)
  const get = (path, headers = {}, method = 'GET') =>
    request(`${config.origin}${path}`, {
      headers,
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    })
  for (const [path, method] of [
    ['/', 'GET'],
    ['/health', 'GET'],
    ['/auth/login', 'POST'],
    ['/users/me', 'GET'],
    ['/open-api/doc', 'GET'],
    ['/open-api/scalar', 'GET'],
    ['/health', 'OPTIONS'],
  ]) {
    const response = await get(path, {}, method)
    assert([302, 401, 403].includes(response.status))
    if (response.status === 302) {
      const target = new URL(response.headers.get('location'))
      assert.equal(target.origin, config.access_issuer)
      assert(target.pathname.startsWith('/cdn-cgi/access/'))
    }
    await response.body?.cancel()
  }
  const headers = { 'CF-Access-Client-Id': credentials.id, 'CF-Access-Client-Secret': credentials.secret }
  const health = await get('/health', headers)
  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), { ok: true })
  const me = await get('/users/me', headers)
  assert.equal(me.status, 401)
  await me.body?.cancel()
}
