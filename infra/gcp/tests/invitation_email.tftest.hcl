mock_provider "google" {
  override_during = plan
}

mock_provider "google-beta" {}

variables {
  project_id       = "test-project"
  app_image_digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  enable_api_docs  = true
  invoker_members  = ["user:developer@example.com"]
  app_environment = {
    SUPABASE_URL                  = "https://test.supabase.co"
    SUPABASE_PUBLISHABLE_KEY      = "sb_publishable_test"
    ALLOWED_ORIGINS               = "https://example.com"
    PASSWORD_RESET_FROM_EMAIL     = "noreply@example.com"
    PASSWORD_RESET_URL_BASE       = "https://example.com/reset-password"
    EMAIL_VERIFICATION_FROM_EMAIL = "noreply@example.com"
    EMAIL_VERIFICATION_URL_BASE   = "https://example.com/verify-email"
  }
  secret_versions = {
    DATABASE_URL                    = "2"
    JWT_SECRET                      = "1"
    REFRESH_TOKEN_SECRET            = "1"
    PASSWORD_RESET_TOKEN_SECRET     = "1"
    EMAIL_VERIFICATION_TOKEN_SECRET = "1"
    RESEND_API_KEY                  = "1"
  }
}

run "disabled_by_default" {
  command = plan

  assert {
    condition = (
      length(google_cloud_run_v2_job.invitation_email) == 0 &&
      length(google_cloud_scheduler_job.invitation_email) == 0 &&
      length(google_service_account.invitation_email) == 0 &&
      !contains(keys(local.app_environment), "ENABLE_INVITATION_EMAIL")
    )
    error_message = "既定値では招待メールを配信待ちに登録せず、JobとSchedulerも作成しません。"
  }
}

run "bootstrap_paused_worker_with_isolated_permissions" {
  command = plan

  variables {
    invitation_email = {
      worker_image_digest = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }
  }

  override_resource {
    target          = google_service_account.invitation_email["worker"]
    override_during = plan
    values = {
      email = "worker@test-project.iam.gserviceaccount.com"
    }
  }

  override_resource {
    target          = google_service_account.invitation_email["scheduler"]
    override_during = plan
    values = {
      email = "scheduler@test-project.iam.gserviceaccount.com"
    }
  }

  assert {
    condition = (
      endswith(google_cloud_run_v2_job.invitation_email[0].template[0].template[0].containers[0].image, "@${var.invitation_email.worker_image_digest}") &&
      endswith(google_cloud_run_v2_service.app[0].template[0].containers[0].image, "@${var.app_image_digest}") &&
      google_cloud_run_v2_job.invitation_email[0].template[0].template[0].containers[0].command == tolist(["bun", "run", "invitations:deliver"]) &&
      google_cloud_run_v2_job.invitation_email[0].template[0].template[0].service_account == "worker@test-project.iam.gserviceaccount.com"
    )
    error_message = "Jobは専用SAとServiceから独立したdigestでワーカーを実行します。"
  }

  assert {
    condition = (
      google_cloud_scheduler_job.invitation_email[0].paused &&
      google_cloud_scheduler_job.invitation_email[0].schedule == "*/15 * * * *" &&
      endswith(google_cloud_scheduler_job.invitation_email[0].http_target[0].uri, "/jobs/hono-app-dev-invite-worker:run") &&
      google_cloud_scheduler_job.invitation_email[0].http_target[0].oauth_token[0].service_account_email == "scheduler@test-project.iam.gserviceaccount.com" &&
      google_cloud_run_v2_job_iam_member.invitation_scheduler[0].role == "roles/run.invoker" &&
      google_cloud_run_v2_job_iam_member.invitation_scheduler[0].member == "serviceAccount:scheduler@test-project.iam.gserviceaccount.com"
    )
    error_message = "初回は停止状態で構築し、専用Scheduler SAに対象Jobの起動権限を付与します。"
  }

  assert {
    condition = (
      toset(keys(google_secret_manager_secret_iam_member.invitation_worker)) == toset(["DATABASE_URL", "RESEND_API_KEY"]) &&
      alltrue([for binding in google_secret_manager_secret_iam_member.invitation_worker :
        binding.role == "roles/secretmanager.secretAccessor" && binding.member == "serviceAccount:worker@test-project.iam.gserviceaccount.com"
      ]) &&
      tomap({ for item in google_cloud_run_v2_job.invitation_email[0].template[0].template[0].containers[0].env :
        item.name => item.value_source[0].secret_key_ref[0].version
      }) == tomap({ DATABASE_URL = "2", RESEND_API_KEY = "1" })
    )
    error_message = "ワーカーにはDBとResendの指定バージョンだけを渡します。"
  }

  assert {
    condition = anytrue([
      for policy in google_artifact_registry_repository.app.cleanup_policies :
      policy.action == "KEEP" && anytrue([
        for condition in policy.condition :
        condition.tag_state == "TAGGED" && anytrue([
          for prefix in condition.tag_prefixes : startswith("release-invitation-worker-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", prefix)
        ])
      ])
    ])
    error_message = "Job用保護タグがRegistryの保持対象に含まれる必要があります。"
  }
}

run "enable_delivery_and_schedule" {
  command = plan

  variables {
    invitation_email = {
      worker_image_digest = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      enabled             = true
      schedule_paused     = false
      from_email          = "noreply@example.com"
      scalar_url          = "https://example.com/open-api/scalar"
    }
  }

  assert {
    condition = (
      !google_cloud_scheduler_job.invitation_email[0].paused &&
      local.app_environment.ENABLE_INVITATION_EMAIL == "true" &&
      local.app_environment.INVITATION_EMAIL_FROM == "noreply@example.com" &&
      local.app_environment.INVITATION_EMAIL_SCALAR_URL == "https://example.com/open-api/scalar"
    )
    error_message = "配信を有効にしたとき、Serviceには案内設定を注入し、Schedulerの再開を指定できます。"
  }
}

run "reject_enabled_without_worker" {
  command = plan

  variables {
    invitation_email = {
      enabled = true
    }
  }

  expect_failures = [var.invitation_email]
}
