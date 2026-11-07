locals {
  health_monitor_enabled  = terraform.workspace == "dev" && var.app_image_digest != null && var.alert_notification_channel != null
  health_monitor_name     = "${local.service_name}-iap-health"
  health_monitor_accounts = local.health_monitor_enabled ? toset(["scheduler", "workflow", "iap"]) : toset([])
}

resource "google_project_service" "health_monitor" {
  for_each = local.health_monitor_enabled ? toset([
    "cloudscheduler.googleapis.com",
    "logging.googleapis.com",
    "workflows.googleapis.com",
  ]) : toset([])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_service_account" "health_monitor" {
  for_each     = local.health_monitor_accounts
  project      = var.project_id
  account_id   = "${local.service_name}-health-${each.key}"
  display_name = "dev IAP稼働監視用 ${each.key}"

  depends_on = [google_project_service.required]
}

resource "google_project_iam_custom_role" "health_scheduler" {
  count       = local.health_monitor_enabled ? 1 : 0
  project     = var.project_id
  role_id     = "honoDevHealthScheduler"
  title       = "Hono dev health scheduler"
  permissions = ["workflows.executions.create"]
}

# Workflowsの実行権限はプロジェクト単位。Schedulerには起動の権限だけを付ける。
resource "google_project_iam_member" "health_scheduler" {
  count   = local.health_monitor_enabled ? 1 : 0
  project = var.project_id
  role    = google_project_iam_custom_role.health_scheduler[0].name
  member  = "serviceAccount:${google_service_account.health_monitor["scheduler"].email}"
}

resource "google_project_iam_custom_role" "health_token" {
  count       = local.health_monitor_enabled ? 1 : 0
  project     = var.project_id
  role_id     = "honoDevHealthToken"
  title       = "Hono dev health token"
  permissions = ["iam.serviceAccounts.getAccessToken"]
}

resource "google_service_account_iam_member" "health_token" {
  count              = local.health_monitor_enabled ? 1 : 0
  service_account_id = google_service_account.health_monitor["iap"].name
  role               = google_project_iam_custom_role.health_token[0].name
  member             = "serviceAccount:${google_service_account.health_monitor["workflow"].email}"
}

resource "google_workflows_workflow" "iap_health" {
  count = local.health_monitor_enabled ? 1 : 0

  project         = var.project_id
  region          = var.region
  name            = local.health_monitor_name
  service_account = google_service_account.health_monitor["workflow"].id
  call_log_level  = "LOG_NONE"
  source_contents = file("${path.module}/workflows/iap-health.yaml")
  user_env_vars = {
    # URLはWorkflowがプロジェクト番号とリージョンから構成する。Cloud Runのイメージ更新に連動させない。
    CLOUD_RUN_SERVICE = local.service_name
    IAP_MONITOR_SA    = google_service_account.health_monitor["iap"].email
  }

  depends_on = [
    google_project_service.health_monitor,
    google_project_service.cd,
    google_iap_web_cloud_run_service_iam_binding.users,
    google_service_account_iam_member.health_token,
  ]
}

resource "google_cloud_scheduler_job" "iap_health" {
  count = local.health_monitor_enabled ? 1 : 0

  project          = var.project_id
  region           = var.region
  name             = local.health_monitor_name
  paused           = !var.enable_service_monitoring
  schedule         = "*/15 * * * *"
  time_zone        = "Asia/Tokyo"
  attempt_deadline = "30s"

  http_target {
    http_method = "POST"
    uri         = "https://workflowexecutions.googleapis.com/v1/${google_workflows_workflow.iap_health[0].id}/executions"
    headers     = { "Content-Type" = "application/json" }
    body        = base64encode("{}")

    oauth_token {
      service_account_email = google_service_account.health_monitor["scheduler"].email
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }
  }

  depends_on = [
    google_project_iam_member.health_scheduler,
    google_monitoring_alert_policy.iap_health,
  ]
}

resource "google_monitoring_alert_policy" "iap_health" {
  count = local.health_monitor_enabled ? 1 : 0

  project               = var.project_id
  display_name          = "${local.service_name} IAP health"
  enabled               = var.enable_service_monitoring
  combiner              = "OR"
  severity              = "WARNING"
  notification_channels = [var.alert_notification_channel]

  conditions {
    display_name = "IAP稼働監視の実行失敗"

    condition_matched_log {
      filter = join("\n", [
        "resource.type=\"workflows.googleapis.com/Workflow\"",
        "resource.labels.workflow_id=\"${google_workflows_workflow.iap_health[0].name}\"",
        "resource.labels.location=\"${var.region}\"",
        "log_id(\"workflows.googleapis.com/executions_system\")",
        "jsonPayload.state=\"FAILED\"",
      ])
    }
  }

  alert_strategy {
    auto_close = "1800s"

    notification_rate_limit {
      period = "900s"
    }
  }

  documentation {
    mime_type = "text/markdown"
    content   = "Cloud Run `${local.service_name}` のIAP稼働監視が失敗しました。Workflowsの実行履歴とdocs/deployment-gcp.mdの切り分け手順を確認してください。"
  }

  depends_on = [google_project_service.required, google_project_service.health_monitor]
}
