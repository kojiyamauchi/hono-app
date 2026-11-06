# 監視構成も実GCPへ接続せず、対象サービス・集計条件・通知先の参照を検証する。
mock_provider "google" {}
mock_provider "google-beta" {}

variables {
  project_id = "test-project"
}

run "bootstrap_without_alert" {
  command = plan

  assert {
    condition     = contains([for api in google_project_service.required : api.service], "monitoring.googleapis.com")
    error_message = "アラートポリシーの作成・参照に必要なMonitoring APIを有効化する必要があります。"
  }
  assert {
    condition     = length(google_monitoring_alert_policy.server_errors) == 0
    error_message = "通知先が未設定のまま、通知されないアラートポリシーを作成してはいけません。"
  }
}

run "server_error_alert_scoped_to_service" {
  command = plan

  variables {
    alert_notification_channel = "projects/test-project/notificationChannels/1234567890"
  }

  assert {
    condition = alltrue([for expression in [
      "metric.type = \"run.googleapis.com/request_count\"",
      "resource.type = \"cloud_run_revision\"",
      "resource.labels.service_name = \"hono-app-dev\"",
      "metric.labels.response_code_class = \"5xx\"",
      ] : strcontains(google_monitoring_alert_policy.server_errors[0].conditions[0].condition_threshold[0].filter, expression)
    ])
    error_message = "対象サービスのCloud Runが返した5xxだけを集計する必要があります。"
  }
  assert {
    condition = (
      google_monitoring_alert_policy.server_errors[0].conditions[0].condition_threshold[0].aggregations[0].alignment_period == "300s" &&
      google_monitoring_alert_policy.server_errors[0].conditions[0].condition_threshold[0].aggregations[0].per_series_aligner == "ALIGN_SUM" &&
      google_monitoring_alert_policy.server_errors[0].conditions[0].condition_threshold[0].aggregations[0].cross_series_reducer == "REDUCE_SUM" &&
      join(",", google_monitoring_alert_policy.server_errors[0].conditions[0].condition_threshold[0].aggregations[0].group_by_fields) == "resource.label.service_name"
    )
    error_message = "5分間の件数を合計し、サービス内のリビジョンを合算する必要があります。"
  }
  assert {
    condition = (
      google_monitoring_alert_policy.server_errors[0].conditions[0].condition_threshold[0].comparison == "COMPARISON_GT" &&
      google_monitoring_alert_policy.server_errors[0].conditions[0].condition_threshold[0].threshold_value > 0
    )
    error_message = "単発の5xxで発報しないしきい値が必要です。"
  }
  # 欠損データの扱いは60秒以上のdurationでのみ有効になるため、設定文字列だけでなく組み合わせを検証する。
  assert {
    condition = (
      google_monitoring_alert_policy.server_errors[0].conditions[0].condition_threshold[0].evaluation_missing_data == "EVALUATION_MISSING_DATA_INACTIVE" &&
      tonumber(trimsuffix(google_monitoring_alert_policy.server_errors[0].conditions[0].condition_threshold[0].duration, "s")) >= 60
    )
    error_message = "リクエストがない時間帯の欠損で発報・継続しない設定が必要です。欠損データの扱いは60秒以上のdurationでのみ有効です。"
  }
  assert {
    condition = (
      google_monitoring_alert_policy.server_errors[0].combiner == "OR" &&
      join(",", google_monitoring_alert_policy.server_errors[0].notification_channels) == "projects/test-project/notificationChannels/1234567890"
    )
    error_message = "Consoleで管理する通知チャネルをリソース名で参照する必要があります。"
  }
}

run "reject_email_as_channel" {
  command = plan
  variables {
    alert_notification_channel = "alerts@example.com"
  }
  expect_failures = [var.alert_notification_channel]
}

run "reject_placeholder_channel" {
  command = plan
  variables {
    alert_notification_channel = "projects/REPLACE_ME/notificationChannels/REPLACE_ME"
  }
  expect_failures = [var.alert_notification_channel]
}
