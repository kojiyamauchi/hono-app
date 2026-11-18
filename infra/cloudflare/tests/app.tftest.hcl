mock_provider "cloudflare" {
  override_during = plan
  mock_resource "cloudflare_worker" {
    defaults = { id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
  }
  mock_resource "cloudflare_zero_trust_access_application" {
    defaults = { aud = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }
  }
}

variables {
  account_id     = "11111111111111111111111111111111"
  hyperdrive_id  = "22222222222222222222222222222222"
  allowed_emails = ["developer@example.com"]
}

run "app_disabled_by_default" {
  command = plan
  assert {
    condition     = length(cloudflare_worker.app) == 0 && length(cloudflare_zero_trust_access_application.app) == 0
    error_message = "既存設定では本体基盤を作成してはいけません。"
  }
}

run "app_bootstrap_with_url_disabled" {
  command = plan
  variables {
    app_config = {
      workers_subdomain = "example"
      access_issuer     = "https://example.cloudflareaccess.com"
      service_token_id  = "11111111-2222-3333-4444-555555555555"
    }
  }
  assert {
    condition     = !cloudflare_worker.app[0].subdomain.enabled && !cloudflare_worker.app[0].subdomain.previews_enabled && !cloudflare_worker.app[0].observability.enabled
    error_message = "本体の初回構築ではURL・preview・ログを無効にしてください。"
  }
  assert {
    condition = (
      cloudflare_worker.app[0].name == "hono-app-dev" &&
      cloudflare_zero_trust_access_application.app[0].destinations[0].worker_id == cloudflare_worker.app[0].id &&
      !cloudflare_zero_trust_access_application.app[0].options_preflight_bypass &&
      length(cloudflare_zero_trust_access_application.app[0].policies) == 2 &&
      cloudflare_zero_trust_access_policy.app_automation[0].decision == "non_identity" &&
      one(cloudflare_zero_trust_access_policy.app_automation[0].include).service_token.token_id == var.app_config.service_token_id &&
      one(cloudflare_zero_trust_access_policy.app_browser[0].include).email.email == "developer@example.com" &&
      output.app_cd_config.origin == "https://hono-app-dev.example.workers.dev" &&
      output.app_cd_config.access_audience == "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    )
    error_message = "本体専用Worker・Access・トークン・CD出力の対応が必要です。"
  }
  assert {
    condition     = cloudflare_worker.compatibility.name == "hono-app-dev-compatibility" && !cloudflare_worker.compatibility.subdomain.enabled
    error_message = "検証Workerの設定へ本体設定を混入させてはいけません。"
  }
}

run "app_reject_spike_token_reuse" {
  command = plan
  variables {
    access_service_token_id = "11111111-2222-3333-4444-555555555555"
    app_config = {
      workers_subdomain = "example"
      access_issuer     = "https://example.cloudflareaccess.com"
      service_token_id  = "11111111-2222-3333-4444-555555555555"
    }
  }
  expect_failures = [cloudflare_worker.app]
}

run "app_reject_issuer_path" {
  command = plan
  variables {
    app_config = {
      workers_subdomain = "example"
      access_issuer     = "https://example.cloudflareaccess.com/health"
      service_token_id  = "11111111-2222-3333-4444-555555555555"
    }
  }
  expect_failures = [var.app_config]
}
