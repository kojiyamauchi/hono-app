# AWSへ接続せず、利用可能AZの取得結果を固定して検証する。
mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = {
      names = ["ap-northeast-1a", "ap-northeast-1c"]
    }
  }
}

variables {
  service_name = "subnet-validation-test"
  env          = "dev"
  subnets = {
    public = [
      { cidr_block = "10.0.0.0/24", availability_zone = "ap-northeast-1a" },
      { cidr_block = "10.0.1.0/24", availability_zone = "ap-northeast-1c" },
    ]
    private = [
      { cidr_block = "10.0.2.0/24", availability_zone = "ap-northeast-1a" },
      { cidr_block = "10.0.3.0/24", availability_zone = "ap-northeast-1c" },
    ]
  }
}

run "two_available_zones" {
  command = plan

  assert {
    condition     = length(data.aws_availability_zones.availability_zone.exclude_names) == 0
    error_message = "モジュールで除外AZを省略した場合は空リストを使用する必要があります。"
  }
}

run "configured_excluded_zone" {
  command = plan

  variables {
    excluded_availability_zones = ["ap-northeast-1b"]
  }

  assert {
    condition     = data.aws_availability_zones.availability_zone.exclude_names == toset(["ap-northeast-1b"])
    error_message = "入力した除外AZをデータソースへ渡す必要があります。"
  }
}

run "only_one_available_zone" {
  command = plan

  override_data {
    target = data.aws_availability_zones.availability_zone
    values = { names = ["ap-northeast-1a"] }
  }

  expect_failures = [data.aws_availability_zones.availability_zone]
}

run "no_available_zones" {
  command = plan

  override_data {
    target = data.aws_availability_zones.availability_zone
    values = { names = [] }
  }

  expect_failures = [data.aws_availability_zones.availability_zone]
}

run "empty_excluded_zone" {
  command = plan

  variables {
    excluded_availability_zones = [""]
  }

  expect_failures = [var.excluded_availability_zones]
}

run "whitespace_excluded_zone" {
  command = plan

  variables {
    excluded_availability_zones = [" ap-northeast-1b"]
  }

  expect_failures = [var.excluded_availability_zones]
}

run "null_excluded_zone" {
  command = plan

  variables {
    excluded_availability_zones = [null]
  }

  expect_failures = [var.excluded_availability_zones]
}
