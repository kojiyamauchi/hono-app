/** Terraform出力とCloudflare API応答の組を毎回独立して生成する。 */
export function protectionFixture() {
  const config = {
    account_id: '1'.repeat(32),
    worker_id: '2'.repeat(32),
    worker_name: 'hono-app-dev',
    hyperdrive_id: '3'.repeat(32),
    access_application_id: '11111111-1111-1111-1111-111111111111',
    access_audience: '4'.repeat(64),
    access_issuer: 'https://example.cloudflareaccess.com',
    origin: 'https://hono-app-dev.example.workers.dev',
    enable_worker_url: true,
    allowed_emails: ['developer@example.com'],
    service_token_id: '22222222-2222-2222-2222-222222222222',
    access_policy_ids: ['33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444'],
  }
  const application = {
    id: config.access_application_id,
    aud: config.access_audience,
    type: 'self_hosted',
    destinations: [{ type: 'worker', worker_id: config.worker_id }],
    options_preflight_bypass: false,
    policies: config.access_policy_ids.map((id) => ({ id })),
  }
  const policies = [
    { id: config.access_policy_ids[0], decision: 'allow', include: [{ email: { email: 'developer@example.com' } }] },
    { id: config.access_policy_ids[1], decision: 'non_identity', include: [{ service_token: { token_id: config.service_token_id } }] },
  ]
  return [config, application, policies, { auth_domain: 'example.cloudflareaccess.com' }, { enabled: true, previews_enabled: false }]
}

/** 実資格情報を使わず、必須bindingを満たす入力を作る。 */
export function appSecretsFixture() {
  return {
    JWT_SECRET: 'test-jwt',
    REFRESH_TOKEN_SECRET: 'test-refresh',
    PASSWORD_RESET_TOKEN_SECRET: 'test-reset',
    EMAIL_VERIFICATION_TOKEN_SECRET: 'test-email',
    RESEND_API_KEY: 'test-resend',
    PASSWORD_RESET_FROM_EMAIL: 'noreply@example.com',
    PASSWORD_RESET_URL_BASE: 'https://example.com/reset',
    EMAIL_VERIFICATION_FROM_EMAIL: 'noreply@example.com',
    EMAIL_VERIFICATION_URL_BASE: 'https://example.com/verify',
    ALLOWED_ORIGINS: 'https://example.com',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'test-key',
  }
}
