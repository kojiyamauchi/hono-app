# AWSへの通信やリソース作成を行わず、NAT Gatewayの配置とタグを検証する。
mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = {
      names = ["ap-northeast-1a", "ap-northeast-1c", "ap-northeast-1d"]
    }
  }
}

variables {
  service_name = "nat-gateway-test"
  env          = "dev"
  subnets = {
    public = [
      { cidr_block = "10.0.0.0/24", availability_zone = "ap-northeast-1a" },
      { cidr_block = "10.0.1.0/24", availability_zone = "ap-northeast-1c" },
      { cidr_block = "10.0.4.0/24", availability_zone = "ap-northeast-1d" },
    ]
    private = [
      { cidr_block = "10.0.2.0/24", availability_zone = "ap-northeast-1a" },
      { cidr_block = "10.0.3.0/24", availability_zone = "ap-northeast-1c" },
      { cidr_block = "10.0.5.0/24", availability_zone = "ap-northeast-1d" },
    ]
  }
}

run "one_nat_gateway_per_az" {
  command = plan

  assert {
    condition = (
      length(aws_eip.eips) == 3 &&
      length(aws_nat_gateway.nat_gateways) == 3 &&
      local.nat_gateway_subnet_cidr_by_az["ap-northeast-1d"] == "10.0.4.0/24"
    )
    error_message = "EIPとNAT GatewayはAZごとに1つ作成する必要があります。"
  }

  assert {
    condition = (
      aws_eip.eips["ap-northeast-1a"].domain == "vpc" &&
      aws_eip.eips["ap-northeast-1a"].tags["Name"] == "nat-gateway-test-dev-ap-northeast-1a-eip" &&
      aws_eip.eips["ap-northeast-1a"].tags["Env"] == "dev" &&
      aws_eip.eips["ap-northeast-1a"].tags["AvailabilityZone"] == "ap-northeast-1a" &&
      aws_eip.eips["ap-northeast-1a"].tags["Usage"] == "NAT"
    )
    error_message = "NAT Gateway用EIPはVPCドメインと配置先AZに対応するタグを持つ必要があります。"
  }

  assert {
    condition = (
      aws_nat_gateway.nat_gateways["ap-northeast-1d"].tags["Name"] == "nat-gateway-test-dev-ap-northeast-1d-nat-gateway" &&
      aws_nat_gateway.nat_gateways["ap-northeast-1d"].tags["Env"] == "dev" &&
      aws_nat_gateway.nat_gateways["ap-northeast-1d"].tags["AvailabilityZone"] == "ap-northeast-1d"
    )
    error_message = "NAT Gatewayは配置先AZに対応するタグを持つ必要があります。"
  }
}

run "multiple_public_subnets_in_same_az" {
  command = plan

  variables {
    subnets = {
      public = [
        { cidr_block = "10.0.4.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.1.0/24", availability_zone = "ap-northeast-1c" },
        { cidr_block = "10.0.0.0/24", availability_zone = "ap-northeast-1a" },
      ]
      private = [
        { cidr_block = "10.0.2.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.3.0/24", availability_zone = "ap-northeast-1c" },
        { cidr_block = "10.0.5.0/24", availability_zone = "ap-northeast-1a" },
      ]
    }
  }

  assert {
    condition = (
      length(aws_nat_gateway.nat_gateways) == 2 &&
      local.nat_gateway_subnet_cidr_by_az["ap-northeast-1a"] == "10.0.0.0/24" &&
      local.nat_gateway_subnet_cidr_by_az["ap-northeast-1c"] == "10.0.1.0/24"
    )
    error_message = "NAT GatewayはAZごとに1つ作成し、CIDRの辞書順で先頭のpublic subnetへ配置する必要があります。"
  }
}
