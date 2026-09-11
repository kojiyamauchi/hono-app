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
