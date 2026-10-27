# AWSリソースを作成せず、ログ名・環境タグ・保持期間を検証する。
mock_provider "aws" {}

variables {
  service_name = "hono-app"
  env          = "dev"
}

run "default_log_group" {
  command = plan

  assert {
    condition = (
      aws_cloudwatch_log_group.log_group.name == "hono-app-dev-log-group" &&
      aws_cloudwatch_log_group.log_group.retention_in_days == 30 &&
      aws_cloudwatch_log_group.log_group.tags["Name"] == "hono-app-dev-log-group" &&
      aws_cloudwatch_log_group.log_group.tags["ServiceName"] == "hono-app" &&
      aws_cloudwatch_log_group.log_group.tags["Env"] == "dev" &&
      output.log_group_name == "hono-app-dev-log-group"
    )
    error_message = "ロググループはサービス名と環境を含み、標準タグと保持期間を持つ必要があります。"
  }
}

run "suffix_and_custom_settings" {
  command = plan

  variables {
    service_suffix            = "api"
    log_retention_in_days     = 7
    log_group_additional_tags = { Usage = "test" }
  }

  assert {
    condition = (
      aws_cloudwatch_log_group.log_group.name == "hono-app-api-dev-log-group" &&
      aws_cloudwatch_log_group.log_group.tags["Name"] == "hono-app-api-dev-log-group" &&
      aws_cloudwatch_log_group.log_group.tags["ServiceName"] == "hono-app" &&
      aws_cloudwatch_log_group.log_group.tags["ServiceSuffix"] == "api" &&
      aws_cloudwatch_log_group.log_group.tags["Env"] == "dev" &&
      aws_cloudwatch_log_group.log_group.tags["Usage"] == "test" &&
      aws_cloudwatch_log_group.log_group.retention_in_days == 7
    )
    error_message = "suffixは名前へ一度だけ含め、環境タグと追加設定を保持する必要があります。"
  }
}

run "reserved_tags_are_rejected" {
  command = plan

  variables {
    log_group_additional_tags = { Env = "prod" }
  }

  expect_failures = [var.log_group_additional_tags]
}
