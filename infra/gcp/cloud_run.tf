resource "google_cloud_run_v2_service" "app" {
  count = var.app_image_digest == null ? 0 : 1

  project              = var.project_id
  name                 = local.service_name
  location             = var.region
  deletion_protection  = true
  ingress              = "INGRESS_TRAFFIC_ALL"
  invoker_iam_disabled = false

  # 最小0でアクセスがない間は停止し、最大1で通常のスケールを抑える。
  scaling {
    min_instance_count = 0
    max_instance_count = 1
  }

  template {
    service_account                  = google_service_account.runtime.email
    timeout                          = "30s"
    max_instance_request_concurrency = 8

    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app.repository_id}/hono@${var.app_image_digest}"
      ports {
        container_port = 3000
      }
      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle          = true
        startup_cpu_boost = false
      }

      startup_probe {
        initial_delay_seconds = 0
        period_seconds        = 5
        timeout_seconds       = 2
        failure_threshold     = 12
        http_get {
          path = "/health"
          port = 3000
        }
      }

      dynamic "env" {
        for_each = local.app_environment
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = var.secret_versions
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app[env.key].secret_id
              version = env.value
            }
          }
        }
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  lifecycle {
    precondition {
      condition     = var.app_environment != null && toset(keys(var.secret_versions)) == local.secret_names
      error_message = "API起動前に公開設定と6種類すべてのシークレットバージョンを指定してください。"
    }
    precondition {
      condition     = contains(["dev", "stg", "prod"], terraform.workspace) && length(var.invoker_members) > 0
      error_message = "dev/stg/prod workspaceを選択し、呼び出しを許可するIAM principalを指定してください。"
    }
  }

  depends_on = [google_secret_manager_secret_iam_member.runtime]
}
