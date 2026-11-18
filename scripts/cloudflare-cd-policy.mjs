import assert from 'node:assert/strict'
import { resolve } from 'node:path'

import { getInvitationEmailConfig } from '../src/shared/invitation/services/emailConfig.ts'

/** 対象を本体devと、Terraformで承認したAccess設定だけに固定する。 */
export function assertCloudflareConfig(config) {
  assert.match(config.account_id ?? '', /^[a-f0-9]{32}$/)
  assert.equal(config.worker_name, 'hono-app-dev')
  assert.match(config.worker_id ?? '', /^[a-f0-9]{32}$/)
  assert.match(config.hyperdrive_id ?? '', /^(?!0{32}$)[a-f0-9]{32}$/)
  assert.match(config.access_application_id ?? '', /^[a-f0-9-]{36}$/)
  assert.match(config.access_audience ?? '', /^[a-f0-9]{64}$/)
  assert.match(config.access_issuer ?? '', /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/)
  assert.match(config.origin ?? '', /^https:\/\/hono-app-dev\.[a-z0-9-]+\.workers\.dev$/)
  assert.equal(typeof config.enable_worker_url, 'boolean')
  assert(Array.isArray(config.allowed_emails) && config.allowed_emails.length > 0)
  assert(config.allowed_emails.every((email) => /^[^@\s*]+@[^@\s*]+\.[^@\s*]+$/.test(email)))
  assert.match(config.service_token_id ?? '', /^[a-f0-9-]{36}$/)
  assert.equal(config.access_policy_ids?.length, 2)
  assert(config.access_policy_ids.every((id) => /^[a-f0-9-]{36}$/.test(id)))
  assert.equal(new Set(config.access_policy_ids).size, 2)
}

/** 全パスの保護、専用ヘッダー、許可対象の完全一致をAPIの現在値で検査する。 */
export function assertCloudflareProtection(config, application, policies, organization, subdomain) {
  assertCloudflareConfig(config)
  assert.equal(application.id, config.access_application_id)
  assert.equal(application.aud, config.access_audience)
  assert.equal(application.type, 'self_hosted')
  assert.deepEqual(application.destinations, [{ type: 'worker', worker_id: config.worker_id }])
  assert.equal(application.options_preflight_bypass, false)
  assert(!application.read_service_tokens_from_header)
  assert(!application.domain)
  assert.equal(`https://${organization.auth_domain}`, config.access_issuer)
  assert.deepEqual(application.policies?.map(({ id }) => id).sort(), [...config.access_policy_ids].sort())
  assert.deepEqual(policies.map(({ id }) => id).sort(), [...config.access_policy_ids].sort())
  const browser = policies.find(({ decision }) => decision === 'allow')
  const automation = policies.find(({ decision }) => decision === 'non_identity')
  assert(browser && automation)
  for (const policy of policies) {
    assert(!policy.exclude?.length && !policy.require?.length)
  }
  assert.deepEqual(
    browser.include,
    [...config.allowed_emails].sort().map((email) => ({ email: { email } })),
  )
  assert.deepEqual(automation.include, [{ service_token: { token_id: config.service_token_id } }])
  assert.equal(subdomain.enabled, config.enable_worker_url)
  assert.equal(subdomain.previews_enabled, false)
}

/** 自由形式のWrangler設定を受け取らず、本体テンプレートから必要項目だけ構築する。 */
export function createCloudflareConfig(config, template, root) {
  assertCloudflareConfig(config)
  return {
    ...template,
    name: config.worker_name,
    account_id: config.account_id,
    main: resolve(root, 'src/cloudflare.ts'),
    alias: { '@/generated/prisma/client': resolve(root, 'scripts/cloudflare-app/.wrangler/prisma/client.ts') },
    workers_dev: config.enable_worker_url,
    preview_urls: false,
    hyperdrive: [{ binding: 'HYPERDRIVE', id: config.hyperdrive_id }],
    vars: { ACCESS_ISSUER: config.access_issuer, ACCESS_AUDIENCE: config.access_audience },
  }
}

const secretNames = [
  'JWT_SECRET',
  'REFRESH_TOKEN_SECRET',
  'PASSWORD_RESET_TOKEN_SECRET',
  'EMAIL_VERIFICATION_TOKEN_SECRET',
  'RESEND_API_KEY',
  'PASSWORD_RESET_FROM_EMAIL',
  'PASSWORD_RESET_URL_BASE',
  'EMAIL_VERIFICATION_FROM_EMAIL',
  'EMAIL_VERIFICATION_URL_BASE',
  'SUPABASE_URL',
  'ALLOWED_ORIGINS',
]
const optionalNames = [
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_ANON_KEY',
  'AUTH_EMAIL_MODE',
  'COOKIE_SAMESITE',
  'ENABLE_API_DOCS',
  'ENABLE_INVITATION_EMAIL',
  'INVITATION_EMAIL_FROM',
  'INVITATION_EMAIL_SCALAR_URL',
]

/** アプリ設定を許可リストで受け取り、CD資格情報や接続文字列のbinding混入を拒否する。 */
export function cloudflareAppSecrets(input) {
  assert(input && typeof input === 'object' && !Array.isArray(input))
  for (const [key, value] of Object.entries(input)) {
    assert([...secretNames, ...optionalNames].includes(key))
    assert.equal(typeof value, 'string')
  }
  for (const key of secretNames) assert(input[key]?.trim())
  assert(input.SUPABASE_PUBLISHABLE_KEY || input.SUPABASE_ANON_KEY)
  assert.match(input.SUPABASE_URL, /^https:\/\/[^/]+\.supabase\.co$/)
  assert(['Lax', 'Strict', 'None', undefined].includes(input.COOKIE_SAMESITE))
  assert(['link', 'scalar', undefined].includes(input.AUTH_EMAIL_MODE))
  for (const key of ['ENABLE_API_DOCS', 'ENABLE_INVITATION_EMAIL']) assert([undefined, 'true', 'false'].includes(input[key]))
  // 招待有効時の組合せは、本体と同じ検証を配備前にも適用する。
  getInvitationEmailConfig(input)
  // Wranglerは省略された既存Secretを維持するため、任意設定も明示的に既定値へ戻す。
  return {
    SUPABASE_PUBLISHABLE_KEY: '',
    SUPABASE_ANON_KEY: '',
    AUTH_EMAIL_MODE: 'link',
    COOKIE_SAMESITE: 'Lax',
    ENABLE_API_DOCS: 'false',
    ENABLE_INVITATION_EMAIL: 'false',
    INVITATION_EMAIL_FROM: '',
    INVITATION_EMAIL_SCALAR_URL: '',
    ...input,
    COOKIE_SECURE: 'true',
    OTEL_SDK_DISABLED: 'true',
    OTEL_TRACES_ENABLED: 'false',
  }
}
