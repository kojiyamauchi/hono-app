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
      local.public_subnet_cidr_by_az["ap-northeast-1d"] == "10.0.4.0/24"
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

run "nat_gateway_uses_public_subnet_in_same_az" {
  command = apply

  assert {
    condition = alltrue([
      for availability_zone, cidr_block in local.public_subnet_cidr_by_az :
      aws_nat_gateway.nat_gateways[availability_zone].subnet_id == aws_subnet.public_subnets[cidr_block].id
    ])
    error_message = "NAT Gatewayは各AZのpublic subnetへ配置する必要があります。"
  }
}

# 先頭のAZとは異なる配置先を明示し、入力順に依存せず集約することを確認する。
run "single_nat_gateway_routes_all_private_subnets" {
  command = apply

  variables {
    single_nat_gateway_availability_zone = "ap-northeast-1c"
  }

  assert {
    condition = (
      keys(aws_eip.eips) == ["ap-northeast-1c"] &&
      keys(aws_nat_gateway.nat_gateways) == ["ap-northeast-1c"] &&
      aws_nat_gateway.nat_gateways["ap-northeast-1c"].subnet_id == aws_subnet.public_subnets["10.0.1.0/24"].id &&
      aws_nat_gateway.nat_gateways["ap-northeast-1c"].allocation_id == aws_eip.eips["ap-northeast-1c"].allocation_id
    )
    error_message = "集約時は指定したAZだけにEIPとNAT Gatewayを作成し、対応するpublicサブネットへ配置する必要があります。"
  }

  assert {
    condition = (
      length(aws_route.private_default_routes) == 3 &&
      alltrue([
        for availability_zone, route_table in aws_route_table.private_route_tables :
        aws_route.private_default_routes[availability_zone].route_table_id == route_table.id &&
        aws_route.private_default_routes[availability_zone].nat_gateway_id == aws_nat_gateway.nat_gateways["ap-northeast-1c"].id
      ])
    )
    error_message = "集約時もprivateサブネットごとのroute tableを維持し、すべてのデフォルトルートを指定したNAT Gatewayへ向ける必要があります。"
  }
}

run "single_nat_gateway_requires_public_subnet_in_selected_az" {
  command = plan

  variables {
    single_nat_gateway_availability_zone = "ap-northeast-1b"
  }

  expect_failures = [var.single_nat_gateway_availability_zone]
}
