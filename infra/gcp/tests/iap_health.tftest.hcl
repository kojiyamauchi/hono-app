# Cloud Runへの到達や通知の実測はデプロイ後に行い、ここでは監視リソース間の配線を検証する。
mock_provider "google" {}

mock_provider "google-beta" {}

variables {
  project_id                 = "test-project"
  alert_notification_channel = "projects/test-project/notificationChannels/1234567890"
  app_image_digest           = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  invoker_members            = ["user:developer@example.com"]
  app_environment = {
    SUPABASE_URL                  = "https://test.supabase.co"
    SUPABASE_PUBLISHABLE_KEY      = "sb_publishable_test_key"
    ALLOWED_ORIGINS               = "https://example.com"
    PASSWORD_RESET_FROM_EMAIL     = "noreply@example.com"
    PASSWORD_RESET_URL_BASE       = "https://example.com/open-api/scalar"
    EMAIL_VERIFICATION_FROM_EMAIL = "noreply@example.com"
    EMAIL_VERIFICATION_URL_BASE   = "https://example.com/open-api/scalar"
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

run "without_service" {
  command = plan

  variables {
    app_image_digest = null
    github_cd        = null
  }

  assert {
    condition = (
      length(google_cloud_scheduler_job.iap_health) == 0 &&
      length(google_workflows_workflow.iap_health) == 0 &&
      length(google_monitoring_alert_policy.iap_health) == 0 &&
      length(google_project_service.health_monitor) == 0
    )
    error_message = "Cloud Run未配備の段階ではIAP稼働監視を作成してはいけません。"
  }
}

run "without_notification_channel" {
  command = plan

  variables {
    alert_notification_channel = null
  }

  assert {
    condition = (
      length(google_cloud_scheduler_job.iap_health) == 0 &&
      length(google_monitoring_alert_policy.iap_health) == 0 &&
      length(google_service_account.health_monitor) == 0
    )
    error_message = "通知先未設定の段階ではIAP稼働監視を作成してはいけません。"
  }
}

run "scheduled_iap_health_check" {
  command = apply

  override_resource {
    target = google_service_account.health_monitor["iap"]
    values = {
      name  = "projects/test-project/serviceAccounts/hono-app-dev-health-iap@test-project.iam.gserviceaccount.com"
      email = "hono-app-dev-health-iap@test-project.iam.gserviceaccount.com"
    }
  }

  override_resource {
    target = google_workflows_workflow.iap_health[0]
    values = {
      id = "projects/test-project/locations/asia-northeast1/workflows/hono-app-dev-iap-health"
    }
  }

  assert {
    condition = (
      toset(keys(google_project_service.health_monitor)) == toset(["cloudscheduler.googleapis.com", "logging.googleapis.com", "workflows.googleapis.com"]) &&
      contains(keys(google_project_service.cd), "iamcredentials.googleapis.com")
    )
    error_message = "Scheduler、Logging、Workflows、IAM CredentialsのAPIを有効化する必要があります。"
  }
  assert {
    condition = (
      google_project_iam_custom_role.health_scheduler[0].permissions == toset(["workflows.executions.create"]) &&
      google_project_iam_member.health_scheduler[0].member == "serviceAccount:${google_service_account.health_monitor["scheduler"].email}" &&
      google_project_iam_custom_role.health_token[0].permissions == toset(["iam.serviceAccounts.getAccessToken"]) &&
      google_service_account_iam_member.health_token[0].service_account_id == google_service_account.health_monitor["iap"].name &&
      google_service_account_iam_member.health_token[0].member == "serviceAccount:${google_service_account.health_monitor["workflow"].email}" &&
      contains(google_iap_web_cloud_run_service_iam_binding.users[0].members, "serviceAccount:${google_service_account.health_monitor["iap"].email}") &&
      length(google_cloud_run_v2_service_iam_binding.invoker[0].members) == 1
    )
    error_message = "起動、IAP用SAのトークン発行、IAPアクセスの権限をそれぞれのSAに限定する必要があります。"
  }
  assert {
    condition = (
      !google_cloud_scheduler_job.iap_health[0].paused &&
      google_cloud_scheduler_job.iap_health[0].schedule == "*/15 * * * *" &&
      google_cloud_scheduler_job.iap_health[0].http_target[0].http_method == "POST" &&
      google_cloud_scheduler_job.iap_health[0].http_target[0].uri == "https://workflowexecutions.googleapis.com/v1/projects/test-project/locations/asia-northeast1/workflows/hono-app-dev-iap-health/executions" &&
      google_cloud_scheduler_job.iap_health[0].http_target[0].oauth_token[0].service_account_email == google_service_account.health_monitor["scheduler"].email &&
      base64decode(google_cloud_scheduler_job.iap_health[0].http_target[0].body) == "{}"
    )
    error_message = "15分おきに専用SAで対象のWorkflowを通常モードで起動する必要があります。"
  }
  assert {
    condition = (
      google_workflows_workflow.iap_health[0].service_account == google_service_account.health_monitor["workflow"].id &&
      google_workflows_workflow.iap_health[0].call_log_level == "LOG_NONE" &&
      google_workflows_workflow.iap_health[0].user_env_vars.IAP_MONITOR_SA == google_service_account.health_monitor["iap"].email &&
      google_workflows_workflow.iap_health[0].user_env_vars.CLOUD_RUN_SERVICE == "hono-app-dev" &&
      can(yamldecode(google_workflows_workflow.iap_health[0].source_contents).main.steps)
    )
    error_message = "対象サービスとIAP用SAをWorkflowへ渡し、トークンの呼び出しログを無効にする必要があります。"
  }
  assert {
    condition = (
      google_monitoring_alert_policy.iap_health[0].enabled &&
      google_monitoring_alert_policy.iap_health[0].notification_channels == tolist([var.alert_notification_channel]) &&
      alltrue([for expression in [
        "resource.type=\"workflows.googleapis.com/Workflow\"",
        "resource.labels.workflow_id=\"hono-app-dev-iap-health\"",
        "resource.labels.location=\"asia-northeast1\"",
        "log_id(\"workflows.googleapis.com/executions_system\")",
        "jsonPayload.state=\"FAILED\"",
      ] : strcontains(google_monitoring_alert_policy.iap_health[0].conditions[0].condition_matched_log[0].filter, expression)])
    )
    error_message = "対象のWorkflow実行失敗だけを、5xx監視と共通の通知チャネルへ送る必要があります。"
  }
}

run "pause_service_monitoring" {
  command = plan

  variables {
    enable_service_monitoring = false
  }

  assert {
    condition = (
      google_cloud_scheduler_job.iap_health[0].paused &&
      !google_monitoring_alert_policy.iap_health[0].enabled &&
      !google_monitoring_alert_policy.server_errors[0].enabled &&
      length(google_workflows_workflow.iap_health) == 1
    )
    error_message = "監視停止時はジョブ・両アラート・Workflowを保持し、ジョブを一時停止して両アラートを無効化する必要があります。"
  }
}
