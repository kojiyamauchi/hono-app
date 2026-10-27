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

run "empty_tags" {
  command = plan

  variables {
    subnet_additional_tags = {}
  }
}

run "custom_tags" {
  command = plan

  variables {
    subnet_additional_tags = { Usage = "test" }
  }
}

run "reserved_name" {
  command = plan

  variables {
    subnet_additional_tags = { Name = "test" }
  }

  expect_failures = [var.subnet_additional_tags]
}

run "reserved_env" {
  command = plan

  variables {
    subnet_additional_tags = { Env = "test" }
  }

  expect_failures = [var.subnet_additional_tags]
}

run "reserved_availability_zone" {
  command = plan

  variables {
    subnet_additional_tags = { AvailabilityZone = "test" }
  }

  expect_failures = [var.subnet_additional_tags]
}

run "reserved_scope" {
  command = plan

  variables {
    subnet_additional_tags = { Scope = "test" }
  }

  expect_failures = [var.subnet_additional_tags]
}
