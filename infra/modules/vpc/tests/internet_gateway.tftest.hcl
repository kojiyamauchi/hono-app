# AWSへの通信やリソース作成を行わず、Internet Gatewayのタグと入力検証を確認する。
mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = {
      names = ["ap-northeast-1a", "ap-northeast-1c"]
    }
  }
}

variables {
  service_name = "internet-gateway-test"
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

run "default_tags" {
  command = apply

  assert {
    condition = (
      aws_internet_gateway.igw.tags["Name"] == "internet-gateway-test-dev-igw" &&
      aws_internet_gateway.igw.tags["Env"] == "dev" &&
      aws_internet_gateway.igw.tags["VpcId"] == aws_vpc.vpc.id
    )
    error_message = "Internet GatewayはVPCと環境に対応する標準タグを持つ必要があります。"
  }
}

run "custom_tags" {
  command = plan

  variables {
    igw_additional_tags = { Usage = "test" }
  }

  assert {
    condition     = aws_internet_gateway.igw.tags["Usage"] == "test"
    error_message = "Internet Gatewayへ任意の追加タグを設定できる必要があります。"
  }
}

run "reserved_name" {
  command = plan

  variables {
    igw_additional_tags = { Name = "test" }
  }

  expect_failures = [var.igw_additional_tags]
}

run "reserved_env" {
  command = plan

  variables {
    igw_additional_tags = { Env = "test" }
  }

  expect_failures = [var.igw_additional_tags]
}

run "reserved_vpc_id" {
  command = plan

  variables {
    igw_additional_tags = { VpcId = "test" }
  }

  expect_failures = [var.igw_additional_tags]
}
