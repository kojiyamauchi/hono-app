resource "google_artifact_registry_repository" "app" {
  project       = var.project_id
  location      = var.region
  repository_id = local.service_name
  format        = "DOCKER"
  description   = "Honoのruntimeイメージ。migrationはローカル実行し、このリポジトリへ登録しない"

  # 有料の自動脆弱性スキャンは有効にしない。
  vulnerability_scanning_config {
    enablement_config = "DISABLED"
  }

  # 稼働中・復旧用のreleaseタグは残し、それ以外の古いイメージを削除する。
  cleanup_policy_dry_run = false
  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"
    condition {
      tag_state  = "ANY"
      older_than = "86400s"
    }
  }
  cleanup_policies {
    id     = "keep-release"
    action = "KEEP"
    condition {
      tag_state    = "TAGGED"
      tag_prefixes = ["release-"]
    }
  }
  cleanup_policies {
    id     = "keep-latest"
    action = "KEEP"
    most_recent_versions {
      keep_count = 1
    }
  }

  depends_on = [google_project_service.required]
}
