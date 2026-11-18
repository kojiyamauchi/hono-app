mock_provider "cloudflare" {
  override_during = plan

  mock_resource "cloudflare_worker" {
    defaults = { id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
  }
}

variables {
  account_id    = "11111111111111111111111111111111"
  hyperdrive_id = "22222222222222222222222222222222"
  allowed_emails = [
    "developer@example.com",
  ]
}

run "protect_worker_before_enabling_url" {
  command = plan

  assert {
    condition     = !cloudflare_worker.compatibility.subdomain.enabled && !cloudflare_worker.compatibility.subdomain.previews_enabled
    error_message = "初回適用ではworkers.devとpreviewを無効にする必要があります。"
  }

  assert {
    condition = (
      cloudflare_zero_trust_access_application.compatibility.destinations[0].type == "worker" &&
      cloudflare_zero_trust_access_application.compatibility.destinations[0].worker_id == cloudflare_worker.compatibility.id &&
      !cloudflare_zero_trust_access_application.compatibility.options_preflight_bypass
    )
    error_message = "全パス・全公開経路をWorker単位で保護する必要があります。"
  }

  assert {
    condition = (
      cloudflare_zero_trust_access_identity_provider.otp[0].type == "onetimepin" &&
      cloudflare_zero_trust_access_policy.browser.decision == "allow" &&
      cloudflare_zero_trust_access_policy.browser.session_duration == "8h" &&
      one(cloudflare_zero_trust_access_policy.browser.include).email.email == "developer@example.com" &&
      length(cloudflare_zero_trust_access_policy.automation) == 0
    )
    error_message = "ブラウザは指定したメールだけを許可し、未設定のサービストークンを許可しないことが必要です。"
  }
}

run "add_dedicated_service_token" {
  command = plan

  variables {
    access_service_token_id = "11111111-2222-3333-4444-555555555555"
    enable_worker_url       = true
  }

  assert {
    condition = (
      cloudflare_zero_trust_access_policy.automation[0].decision == "non_identity" &&
      one(cloudflare_zero_trust_access_policy.automation[0].include).service_token.token_id == var.access_service_token_id &&
      length(cloudflare_zero_trust_access_application.compatibility.policies) == 2 &&
      cloudflare_worker.compatibility.subdomain.enabled &&
      !cloudflare_worker.compatibility.subdomain.previews_enabled
    )
    error_message = "自動検証専用ポリシーを追加し、URL有効化後もpreviewは無効である必要があります。"
  }
}

run "reuse_existing_otp" {
  command = plan

  variables {
    existing_otp_identity_provider_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
  }

  assert {
    condition = (
      length(cloudflare_zero_trust_access_identity_provider.otp) == 0 &&
      one(cloudflare_zero_trust_access_application.compatibility.allowed_idps) == var.existing_otp_identity_provider_id
    )
    error_message = "既存OTPの再利用時はIdPを重複作成しないことが必要です。"
  }
}

run "reject_wildcard_email" {
  command = plan

  variables {
    allowed_emails = ["*@example.com"]
  }
  expect_failures = [var.allowed_emails]
}

run "reject_empty_email_list" {
  command = plan

  variables {
    allowed_emails = []
  }
  expect_failures = [var.allowed_emails]
}

run "reject_placeholder_hyperdrive" {
  command = plan

  variables {
    hyperdrive_id = "00000000000000000000000000000000"
  }
  expect_failures = [var.hyperdrive_id]
}
