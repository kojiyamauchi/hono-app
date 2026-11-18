import { expect, test } from 'bun:test'
import { activeCloudflareVersion, cloudflareApi, verifyCloudflareHttp, verifyCloudflareInfrastructure } from '../cloudflare-cd-api.mjs'
import { protectionFixture } from './cloudflare-cd-fixtures.js'

test('APIは認証・タイムアウト・リダイレクト拒否を指定し、API失敗を拒否する', async () => {
  const config = protectionFixture()[0]
  const api = cloudflareApi(config, 'token', async (url, options) => {
    expect(url).toStartWith(`https://api.cloudflare.com/client/v4/accounts/${config.account_id}/`)
    expect(options.headers.Authorization).toBe('Bearer token')
    expect(options.redirect).toBe('error')
    expect(options.signal).toBeInstanceOf(AbortSignal)
    return Response.json({ success: true, result: { ok: true } })
  })
  expect(await api('workers/subdomain')).toEqual({ ok: true })
  await expect(cloudflareApi(config, 'token', async () => Response.json({ success: false }))('workers/subdomain')).rejects.toThrow()
})

test('インフラは実Originとキャッシュ無効・verify-fullを照合する', async () => {
  const [config, app, policies, organization, subdomain] = protectionFixture()
  const data = {
    [`access/apps/${config.access_application_id}`]: app,
    ...Object.fromEntries(policies.map((policy) => [`access/policies/${policy.id}`, policy])),
    'access/organizations': organization,
    [`workers/scripts/${config.worker_name}/subdomain`]: subdomain,
    'workers/subdomain': { subdomain: 'example' },
    [`hyperdrive/configs/${config.hyperdrive_id}`]: {
      caching: { disabled: true },
      origin: { scheme: 'postgres' },
      mtls: { sslmode: 'verify-full', ca_certificate_id: 'ca-id' },
    },
  }
  expect(await verifyCloudflareInfrastructure(config, async (path) => data[path])).toEqual({ scheme: 'postgres' })
  data[`hyperdrive/configs/${config.hyperdrive_id}`].mtls.sslmode = 'require'
  await expect(verifyCloudflareInfrastructure(config, async (path) => data[path])).rejects.toThrow()
})

test('100%単一バージョンとソースSHAを照合し、段階配備や古いSHAを拒否する', async () => {
  const config = protectionFixture()[0]
  const id = '55555555-5555-5555-5555-555555555555'
  let percentage = 100
  const api = async (path) =>
    path.endsWith('/deployments')
      ? { deployments: [{ versions: [{ version_id: id, percentage }] }] }
      : { metadata: { created_on: '2026-11-18T00:00:00Z' }, annotations: { 'workers/tag': 'a'.repeat(40) } }
  expect(await activeCloudflareVersion(config, api, 'a'.repeat(40))).toBe(id)
  await expect(activeCloudflareVersion(config, api, 'b'.repeat(40))).rejects.toThrow()
  percentage = 50
  await expect(activeCloudflareVersion(config, api)).rejects.toThrow()
})

test('AccessヘッダーをアプリBearerへ転用せず、全代表パスの拒否とhealthを確認する', async () => {
  const config = protectionFixture()[0]
  const calls = []
  const request = async (url, options) => {
    calls.push([url, options])
    expect(options.headers.Authorization).toBeUndefined()
    expect(options.redirect).toBe('manual')
    if (options.method === 'OPTIONS') {
      expect(options.headers).toEqual({ Origin: config.origin, 'Access-Control-Request-Method': 'GET' })
      return new Response(null, { status: 403 })
    }
    if (!options.headers['CF-Access-Client-Id'])
      return new Response(null, { status: 302, headers: { location: `${config.access_issuer}/cdn-cgi/access/login/test` } })
    expect(options.headers['CF-Access-Client-Secret']).toBe('secret')
    return url.endsWith('/health') ? Response.json({ ok: true }) : new Response(null, { status: 401 })
  }
  await verifyCloudflareHttp(config, { id: 'id', secret: 'secret' }, request)
  expect(calls).toHaveLength(9)
  expect(calls.filter(([, options]) => options.method === 'OPTIONS')).toHaveLength(1)
  await expect(
    verifyCloudflareHttp(config, { id: 'id', secret: 'secret' }, async (url, options) =>
      options.method === 'OPTIONS' ? new Response(null, { status: 400 }) : request(url, options),
    ),
  ).rejects.toThrow()
  await expect(verifyCloudflareHttp(config, { id: 'id', secret: 'secret' }, async () => Response.json({ ok: true }))).rejects.toThrow()
  await expect(
    verifyCloudflareHttp(
      config,
      { id: 'id', secret: 'secret' },
      async () => new Response(null, { status: 302, headers: { location: 'https://evil.example.com/' } }),
    ),
  ).rejects.toThrow()
})
