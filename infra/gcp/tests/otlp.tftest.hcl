mock_provider "google" {
  override_during = plan
  mock_resource "google_service_account" {
    defaults = {
      email = "hono-app-dev-runtime@test-project.iam.gserviceaccount.com"
    }
  }
}

mock_provider "google-beta" {
  override_during = plan
  mock_resource "google_project_service_identity" {
    defaults = {
      email = "service-123456789012@gcp-sa-iap.iam.gserviceaccount.com"
    }
  }
}

variables {
  project_id       = "test-project"
  app_image_digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  invoker_members  = ["user:developer@example.com"]
  app_environment = {
    SUPABASE_URL                  = "https://test.supabase.co"
    SUPABASE_PUBLISHABLE_KEY      = "sb_publishable_test_key"
    ALLOWED_ORIGINS               = "https://example.com"
    PASSWORD_RESET_FROM_EMAIL     = "noreply@example.com"
    PASSWORD_RESET_URL_BASE       = "https://example.com/reset-password"
    EMAIL_VERIFICATION_FROM_EMAIL = "noreply@example.com"
    EMAIL_VERIFICATION_URL_BASE   = "https://example.com/verify-email"
  }
  secret_versions = {
    DATABASE_URL                    = "1"
    JWT_SECRET                      = "1"
    REFRESH_TOKEN_SECRET            = "1"
    PASSWORD_RESET_TOKEN_SECRET     = "1"
    EMAIL_VERIFICATION_TOKEN_SECRET = "1"
    RESEND_API_KEY                  = "1"
  }
}

run "enable_otlp_with_pinned_headers" {
  command = plan
  variables {
    enable_otel_traces        = true
    otel_traces_sampler_ratio = 1
    secret_versions           = merge(var.secret_versions, { OTEL_EXPORTER_OTLP_TRACES_HEADERS = "2" })
  }

  assert {
    condition = alltrue([for name, value in {
      OTEL_TRACES_ENABLED                = "true"
      OTEL_SDK_DISABLED                  = "false"
      OTEL_SERVICE_NAME                  = "hono-app-dev"
      OTEL_TRACES_SAMPLER_RATIO          = "1"
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = "https://otlp.nr-data.net:4318/v1/traces"
      } : anytrue([for env in google_cloud_run_v2_service.app[0].template[0].containers[0].env :
        env.name == name && env.value == value
    ])])
    error_message = "OTLP有効時はdevのサービス名・送信先・指定したサンプリング比率を設定する必要があります。"
  }

  assert {
    condition = (
      length([for env in google_cloud_run_v2_service.app[0].template[0].containers[0].env : env if length(env.value_source) > 0]) == 7 &&
      one([for env in google_cloud_run_v2_service.app[0].template[0].containers[0].env : env.value_source[0].secret_key_ref[0]
        if env.name == "OTEL_EXPORTER_OTLP_TRACES_HEADERS"]) == {
        secret  = "hono-app-dev-otel-exporter-otlp-traces-headers"
        version = "2"
      }
    )
    error_message = "OTLPヘッダーは7件目の機密値として、指定した数値バージョンの参照で渡す必要があります。"
  }
}

run "reject_enabled_otlp_without_headers" {
  command = plan
  variables {
    enable_otel_traces = true
  }
  expect_failures = [google_cloud_run_v2_service.app]
}

run "reject_headers_when_otlp_is_disabled" {
  command = plan
  variables {
    secret_versions = merge(var.secret_versions, { OTEL_EXPORTER_OTLP_TRACES_HEADERS = "2" })
  }
  expect_failures = [google_cloud_run_v2_service.app]
}

run "reject_unpinned_otlp_headers" {
  command = plan
  variables {
    enable_otel_traces = true
    secret_versions    = merge(var.secret_versions, { OTEL_EXPORTER_OTLP_TRACES_HEADERS = "latest" })
  }
  expect_failures = [var.secret_versions]
}

run "reject_out_of_range_sampling" {
  command = plan
  variables {
    otel_traces_sampler_ratio = 1.1
  }
  expect_failures = [var.otel_traces_sampler_ratio]
}
