import { describe, expect, test } from 'bun:test'
import { assertCloudflareProtection, cloudflareAppSecrets, createCloudflareConfig } from '../cloudflare-cd-policy.mjs'

import { protectionFixture } from './cloudflare-cd-fixtures.js'

describe('Cloudflare本体の配備境界', () => {
  test('本体dev・全パス・完全一致ポリシーを許可する', () => expect(() => assertCloudflareProtection(...protectionFixture())).not.toThrow())
  for (const [name, mutate] of [
    [
      '検証Worker',
      (f) => {
        f[0].worker_name = 'hono-app-dev-compatibility'
      },
    ],
    [
      'path限定',
      (f) => {
        f[1].destinations[0].uri = '/health'
        f[1].destinations[0].type = 'public'
      },
    ],
    [
      '別Worker',
      (f) => {
        f[1].destinations[0].worker_id = '5'.repeat(32)
      },
    ],
    [
      '余分なdestination属性',
      (f) => {
        f[1].destinations[0].uri = '/health'
      },
    ],
    [
      'AUD相違',
      (f) => {
        f[1].aud = '5'.repeat(64)
      },
    ],
    [
      '別issuer',
      (f) => {
        f[3].auth_domain = 'other.cloudflareaccess.com'
      },
    ],
    [
      'OPTIONS迂回',
      (f) => {
        f[1].options_preflight_bypass = true
      },
    ],
    [
      'Bearer転用',
      (f) => {
        f[1].read_service_tokens_from_header = 'Authorization'
      },
    ],
    [
      'bypass',
      (f) => {
        f[2][0].decision = 'bypass'
      },
    ],
    [
      'everyone',
      (f) => {
        f[2][0].include = [{ everyone: {} }]
      },
    ],
    [
      '追加許可',
      (f) => {
        f[2][0].include.push({ email_domain: { domain: 'example.com' } })
      },
    ],
    [
      'トークン相違',
      (f) => {
        f[2][1].include[0].service_token.token_id = '55555555-5555-5555-5555-555555555555'
      },
    ],
    [
      'ポリシー追加',
      (f) => {
        f[1].policies.push({ id: '55555555-5555-5555-5555-555555555555' })
      },
    ],
    [
      'preview公開',
      (f) => {
        f[4].previews_enabled = true
      },
    ],
    [
      'URLのdrift',
      (f) => {
        f[4].enabled = false
      },
    ],
    [
      'Origin差替え',
      (f) => {
        f[0].origin = 'https://evil.example.com'
      },
    ],
  ])
    test(`${name}を拒否する`, () => {
      const fixture = protectionFixture()
      mutate(fixture)
      expect(() => assertCloudflareProtection(...fixture)).toThrow()
    })
  test('設定生成は実Hyperdriveだけをbindingし、ローカル接続やSPIKE_TOKENを含めない', async () => {
    const template = await Bun.file('wrangler.json').json()
    const generated = createCloudflareConfig(protectionFixture()[0], template, process.cwd())
    expect(generated.hyperdrive).toEqual([{ binding: 'HYPERDRIVE', id: '3'.repeat(32) }])
    expect(generated.preview_urls).toBe(false)
    expect(generated.durable_objects).toEqual(template.durable_objects)
    expect(generated.migrations).toEqual(template.migrations)
    expect(JSON.stringify(generated)).not.toContain('SPIKE_TOKEN')
  })
  test('秘密値の許可リストと本番Cookieを強制する', () => {
    const secrets = Object.fromEntries(
      [
        'JWT_SECRET',
        'REFRESH_TOKEN_SECRET',
        'PASSWORD_RESET_TOKEN_SECRET',
        'EMAIL_VERIFICATION_TOKEN_SECRET',
        'RESEND_API_KEY',
        'PASSWORD_RESET_FROM_EMAIL',
        'PASSWORD_RESET_URL_BASE',
        'EMAIL_VERIFICATION_FROM_EMAIL',
        'EMAIL_VERIFICATION_URL_BASE',
        'ALLOWED_ORIGINS',
      ].map((key) => [key, 'test']),
    )
    Object.assign(secrets, { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'test' })
    expect(cloudflareAppSecrets(secrets).COOKIE_SECURE).toBe('true')
    expect(cloudflareAppSecrets(secrets).ENABLE_API_DOCS).toBe('false')
    expect(cloudflareAppSecrets(secrets).SUPABASE_PUBLISHABLE_KEY).toBe('')
    expect(() => cloudflareAppSecrets({ ...secrets, AUTH_EMAIL_MODE: 'unknown' })).toThrow()
    for (const key of ['DATABASE_URL', 'SPIKE_TOKEN', 'ACCESS_ISSUER', 'CLOUDFLARE_API_TOKEN', 'COOKIE_SECURE'])
      expect(() => cloudflareAppSecrets({ ...secrets, [key]: 'test' })).toThrow()
    expect(() => cloudflareAppSecrets({ ...secrets, JWT_SECRET: '' })).toThrow()
  })
})
