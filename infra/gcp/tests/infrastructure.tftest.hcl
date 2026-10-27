# GCPへの認証・API呼び出し・リソース作成なしで構成を検証する。
mock_provider "google" {
  mock_resource "google_service_account" {
    defaults = {
      email = "hono-app-dev-runtime@test-project.iam.gserviceaccount.com"
    }
  }
}

variables {
  project_id = "test-project"
}

run "bootstrap_without_service" {
  command = plan

  assert {
    condition     = length(google_cloud_run_v2_service.app) == 0 && length(google_cloud_run_v2_service_iam_member.invoker) == 0
    error_message = "初回は前提リソースだけを用意し、未準備のAPIを起動・公開してはいけません。"
  }
  assert {
    condition     = length(google_secret_manager_secret.app) == 6 && length(google_secret_manager_secret_iam_member.runtime) == 6
    error_message = "対象の6シークレットだけに読み取り権限を付ける必要があります。"
  }
  assert {
    condition     = alltrue([for api in google_project_service.required : !api.disable_on_destroy])
    error_message = "構成を削除したときにプロジェクト共通のAPIを無効化してはいけません。"
  }
  assert {
    condition = anytrue([for policy in google_artifact_registry_repository.app.cleanup_policies :
      policy.action == "KEEP" && try(contains(policy.condition[0].tag_prefixes, "release-"), false)
    ])
    error_message = "稼働中・ロールバック用のreleaseタグ付きイメージを保護する必要があります。"
  }
}

run "private_low_usage_service" {
  command = plan

  variables {
    app_image_digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    invoker_members  = ["user:developer@example.com"]
    app_environment = {
      SUPABASE_URL                  = "https://test.supabase.co"
      SUPABASE_ANON_KEY             = "public-anon-key"
      ALLOWED_ORIGINS               = "http://localhost:3000"
      PASSWORD_RESET_FROM_EMAIL     = "noreply@example.com"
      PASSWORD_RESET_URL_BASE       = "https://example.com/reset-password"
      EMAIL_VERIFICATION_FROM_EMAIL = "noreply@example.com"
      EMAIL_VERIFICATION_URL_BASE   = "https://example.com/verify-email"
      COOKIE_SAMESITE               = "None"
    }
    secret_versions = {
      DATABASE_URL                    = "1"
      JWT_SECRET                      = "2"
      REFRESH_TOKEN_SECRET            = "1"
      PASSWORD_RESET_TOKEN_SECRET     = "1"
      EMAIL_VERIFICATION_TOKEN_SECRET = "1"
      RESEND_API_KEY                  = "1"
    }
  }

  assert {
    condition = (
      google_cloud_run_v2_service.app[0].scaling[0].min_instance_count == 0 &&
      google_cloud_run_v2_service.app[0].scaling[0].max_instance_count == 1 &&
      google_cloud_run_v2_service.app[0].template[0].scaling[0].max_instance_count == 1 &&
      google_cloud_run_v2_service.app[0].template[0].containers[0].resources[0].cpu_idle &&
      !google_cloud_run_v2_service.app[0].template[0].containers[0].resources[0].startup_cpu_boost
    )
    error_message = "最小0・最大1・リクエスト単位課金・CPU boost無効を維持する必要があります。"
  }
  assert {
    condition = (
      !google_cloud_run_v2_service.app[0].invoker_iam_disabled &&
      google_cloud_run_v2_service_iam_member.invoker["user:developer@example.com"].role == "roles/run.invoker"
    )
    error_message = "IAM認証を必須にし、指定した利用者だけに呼び出しを許可する必要があります。"
  }
  assert {
    condition = alltrue([for name, value in {
      COOKIE_SECURE       = "true"
      ENABLE_API_DOCS     = "false"
      OTEL_TRACES_ENABLED = "false"
      OTEL_SDK_DISABLED   = "true"
      } : anytrue([for env in google_cloud_run_v2_service.app[0].template[0].containers[0].env :
        env.name == name && env.value == value
    ])])
    error_message = "Secure Cookieを有効化し、APIドキュメントと外部trace送信を無効にする必要があります。"
  }
  assert {
    condition = length([for env in google_cloud_run_v2_service.app[0].template[0].containers[0].env : env
      if length(env.value_source) > 0
    ]) == 6
    error_message = "6種類の機密値を環境変数の平文ではなくSecret Manager参照で渡す必要があります。"
  }
  assert {
    condition     = endswith(google_cloud_run_v2_service.app[0].template[0].containers[0].image, "@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    error_message = "起動イメージはダイジェストで固定する必要があります。"
  }
}

run "reject_incomplete_release" {
  command = plan
  variables {
    app_image_digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    invoker_members  = ["user:developer@example.com"]
  }
  expect_failures = [google_cloud_run_v2_service.app]
}

run "reject_public_invoker" {
  command = plan
  variables {
    invoker_members = ["allUsers"]
  }
  expect_failures = [var.invoker_members]
}

run "reject_unpinned_secret" {
  command = plan
  variables {
    secret_versions = { DATABASE_URL = "latest" }
  }
  expect_failures = [var.secret_versions]
}

run "reject_placeholder_image" {
  command = plan
  variables {
    app_image_digest = "sha256:0000000000000000000000000000000000000000000000000000000000000000"
  }
  expect_failures = [var.app_image_digest]
}
