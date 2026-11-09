locals {
  invitation_worker_enabled = var.invitation_email.worker_image_digest != null
  invitation_worker_name    = "${local.service_name}-invite-worker"
  invitation_worker_secrets = toset(["DATABASE_URL", "RESEND_API_KEY"])
}

resource "google_service_account" "invitation_email" {
  for_each     = local.invitation_worker_enabled ? toset(["worker", "scheduler"]) : toset([])
  project      = var.project_id
  account_id   = "${local.service_name}-invite-${each.key}"
  display_name = "dev招待メール用 ${each.key}"

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_iam_member" "invitation_worker" {
  for_each  = local.invitation_worker_enabled ? local.invitation_worker_secrets : toset([])
  project   = var.project_id
  secret_id = google_secret_manager_secret.app[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.invitation_email["worker"].email}"
}

resource "google_cloud_run_v2_job" "invitation_email" {
  count               = local.invitation_worker_enabled ? 1 : 0
  project             = var.project_id
  location            = var.region
  name                = local.invitation_worker_name
  deletion_protection = true

  template {
    task_count  = 1
    parallelism = 1
    template {
      service_account = google_service_account.invitation_email["worker"].email
      timeout         = "600s"
      max_retries     = 0

      containers {
        image   = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app.repository_id}/hono@${var.invitation_email.worker_image_digest}"
        command = ["bun", "run", "invitations:deliver"]
        resources {
          limits = { cpu = "1", memory = "512Mi" }
        }

        dynamic "env" {
          for_each = local.invitation_worker_secrets
          content {
            name = env.key
            value_source {
              secret_key_ref {
                secret  = google_secret_manager_secret.app[env.key].secret_id
                version = lookup(var.secret_versions, env.key, null)
              }
            }
          }
        }
      }
    }
  }

  lifecycle {
    precondition {
      condition     = alltrue([for name in local.invitation_worker_secrets : contains(keys(var.secret_versions), name)])
      error_message = "招待メールJobのDBとResendのSecretバージョンを明示してください。"
    }
  }

  depends_on = [google_secret_manager_secret_iam_member.invitation_worker]
}

resource "google_cloud_run_v2_job_iam_member" "invitation_scheduler" {
  count    = local.invitation_worker_enabled ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_job.invitation_email[0].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.invitation_email["scheduler"].email}"
}

resource "google_cloud_scheduler_job" "invitation_email" {
  count = local.invitation_worker_enabled ? 1 : 0

  project          = var.project_id
  region           = var.region
  name             = local.invitation_worker_name
  paused           = var.invitation_email.schedule_paused
  schedule         = "*/15 * * * *"
  time_zone        = "Asia/Tokyo"
  attempt_deadline = "30s"

  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.invitation_email[0].name}:run"
    headers     = { "Content-Type" = "application/json" }
    body        = base64encode("{}")

    oauth_token {
      service_account_email = google_service_account.invitation_email["scheduler"].email
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }
  }

  depends_on = [google_project_service.health_monitor, google_cloud_run_v2_job_iam_member.invitation_scheduler]
}
