# 5xxの集計条件。実データを見て見直す前提の初期値で、根拠はdocs/deployment-gcp.mdへ記載する。
locals {
  server_error_window    = "300s"
  server_error_threshold = 2
}

# Cloud Runが返した5xxだけを対象にし、サービス内のリビジョンを合算して評価する。
# IAPが拒否した未認証リクエストはCloud Runへ到達しないため、この指標には現れない。
resource "google_monitoring_alert_policy" "server_errors" {
  count = var.alert_notification_channel == null ? 0 : 1

  project      = var.project_id
  display_name = "${local.service_name} HTTP 5xx"
  combiner     = "OR"
  severity     = "WARNING"

  conditions {
    display_name = "${local.service_name}の5xxが${local.server_error_window}で${local.server_error_threshold}件を超過"

    condition_threshold {
      filter = join(" AND ", [
        "metric.type = \"run.googleapis.com/request_count\"",
        "resource.type = \"cloud_run_revision\"",
        "resource.labels.service_name = \"${local.service_name}\"",
        "metric.labels.response_code_class = \"5xx\"",
      ])
      comparison      = "COMPARISON_GT"
      threshold_value = local.server_error_threshold
      duration        = "0s"

      # DELTAの件数をwindow内で合計し、リビジョン単位の系列をサービス単位へまとめる。
      aggregations {
        alignment_period     = local.server_error_window
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.label.service_name"]
      }

      trigger {
        count = 1
      }

      # 最小0インスタンスでリクエストがない間は系列が欠損する。欠損を正常扱いにして発報させない。
      evaluation_missing_data = "EVALUATION_MISSING_DATA_INACTIVE"
    }
  }

  # チャネルはConsoleで管理し、メールアドレスを含まないリソース名だけを参照する。
  notification_channels = [var.alert_notification_channel]

  alert_strategy {
    auto_close = "1800s"
  }

  documentation {
    mime_type = "text/markdown"
    content   = "Cloud Run `${local.service_name}` が5xxを返しています。該当時刻のリビジョンとログの確認手順はdocs/deployment-gcp.mdを参照してください。"
  }

  depends_on = [google_project_service.required]
}
