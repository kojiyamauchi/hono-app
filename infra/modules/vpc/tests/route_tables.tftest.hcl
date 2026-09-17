# AWSへの通信やリソース作成を行わず、public/private subnetのroute table構成とタグを検証する。
mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = {
      names = ["ap-northeast-1a", "ap-northeast-1c", "ap-northeast-1d"]
    }
  }
}

variables {
  service_name = "route-table-test"
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

# mock_providerはcomputed属性へモック値を与えるため、for_eachへリソース参照を戻しても
# plan時にキーが既知になる。実providerでの初回plan失敗はterraform testでは再現できないため、
# ここでは各リソースのキー（stateアドレス）が入力値どおりに固定されることを確認する。
run "route_keys_match_input_values" {
  command = plan

  assert {
    condition = (
      keys(aws_route.public_default_routes) == ["ap-northeast-1a", "ap-northeast-1c", "ap-northeast-1d"] &&
      keys(aws_route.private_default_routes) == ["ap-northeast-1a", "ap-northeast-1c", "ap-northeast-1d"] &&
      keys(aws_route_table_association.public_route_table_associations) == ["10.0.0.0/24", "10.0.1.0/24", "10.0.4.0/24"] &&
      keys(aws_route_table_association.private_route_table_associations) == ["10.0.2.0/24", "10.0.3.0/24", "10.0.5.0/24"]
    )
    error_message = "ルートと関連付けのキーは、入力値から決まる値で固定する必要があります。"
  }
}

# vpc_idはplan時に未確定のため、route table自体の検証はapplyで行う。
run "one_route_table_per_az" {
  command = apply

  assert {
    condition = (
      length(aws_route_table.public_route_tables) == 3 &&
      length(aws_route.public_default_routes) == 3 &&
      length(aws_route_table_association.public_route_table_associations) == 3
    )
    error_message = "public subnetのroute tableとデフォルトルートはAZごとに1つ作成し、関連付けはsubnetごとに作成する必要があります。"
  }

  assert {
    condition = (
      length(aws_route_table.private_route_tables) == 3 &&
      length(aws_route.private_default_routes) == 3 &&
      length(aws_route_table_association.private_route_table_associations) == 3
    )
    error_message = "private subnetのroute tableとデフォルトルートはAZごとに1つ作成し、関連付けはsubnetごとに作成する必要があります。"
  }

  assert {
    condition = (
      aws_route_table.public_route_tables["ap-northeast-1d"].vpc_id == aws_vpc.vpc.id &&
      aws_route_table.public_route_tables["ap-northeast-1d"].tags["Name"] == "route-table-test-dev-ap-northeast-1d-public-route-table" &&
      aws_route_table.public_route_tables["ap-northeast-1d"].tags["Env"] == "dev" &&
      aws_route_table.public_route_tables["ap-northeast-1d"].tags["AvailabilityZone"] == "ap-northeast-1d" &&
      aws_route_table.public_route_tables["ap-northeast-1d"].tags["Scope"] == "public"
    )
    error_message = "public subnetのroute tableは配置先AZに対応する標準タグを持つ必要があります。"
  }

  assert {
    condition = (
      aws_route_table.private_route_tables["ap-northeast-1d"].vpc_id == aws_vpc.vpc.id &&
      aws_route_table.private_route_tables["ap-northeast-1d"].tags["Name"] == "route-table-test-dev-ap-northeast-1d-private-route-table" &&
      aws_route_table.private_route_tables["ap-northeast-1d"].tags["Env"] == "dev" &&
      aws_route_table.private_route_tables["ap-northeast-1d"].tags["AvailabilityZone"] == "ap-northeast-1d" &&
      aws_route_table.private_route_tables["ap-northeast-1d"].tags["Scope"] == "private"
    )
    error_message = "private subnetのroute tableは配置先AZに対応する標準タグを持つ必要があります。"
  }

  # public/privateを跨いでNameタグが衝突しないことも確認する。
  assert {
    condition = length(distinct(concat(
      [for route_table in aws_route_table.public_route_tables : route_table.tags["Name"]],
      [for route_table in aws_route_table.private_route_tables : route_table.tags["Name"]]
      ))) == (
      length(aws_route_table.public_route_tables) + length(aws_route_table.private_route_tables)
    )
    error_message = "route tableのNameタグはpublic/privateを跨いで重複しない必要があります。"
  }

  assert {
    condition = (
      length(output.public_subnets) == 3 &&
      length(output.private_subnets) == 3 &&
      output.public_subnets["ap-northeast-1d"] == aws_subnet.public_subnets["10.0.4.0/24"].id &&
      output.private_subnets["ap-northeast-1d"] == aws_subnet.private_subnets["10.0.5.0/24"].id
    )
    error_message = "subnetのoutputはAZをキーとして対応するsubnet IDを返す必要があります。"
  }

  assert {
    condition = (
      length(output.public_route_tables) == 3 &&
      length(output.private_route_tables) == 3 &&
      output.public_route_tables["ap-northeast-1d"] == aws_route_table.public_route_tables["ap-northeast-1d"].id &&
      output.private_route_tables["ap-northeast-1d"] == aws_route_table.private_route_tables["ap-northeast-1d"].id
    )
    error_message = "route tableのoutputはAZをキーとして対応するroute table IDを返す必要があります。"
  }
}

run "public_default_route_targets_internet_gateway" {
  command = apply

  assert {
    condition = alltrue([
      for availability_zone, route_table in aws_route_table.public_route_tables :
      aws_route.public_default_routes[availability_zone].route_table_id == route_table.id &&
      aws_route.public_default_routes[availability_zone].destination_cidr_block == "0.0.0.0/0" &&
      aws_route.public_default_routes[availability_zone].gateway_id == aws_internet_gateway.igw.id
    ])
    error_message = "public subnetのデフォルトルートは、各AZのroute tableからInternet Gatewayへ向ける必要があります。"
  }
}

run "private_default_route_targets_nat_gateway_in_same_az" {
  command = apply

  assert {
    condition = alltrue([
      for availability_zone, route_table in aws_route_table.private_route_tables :
      aws_route.private_default_routes[availability_zone].route_table_id == route_table.id &&
      aws_route.private_default_routes[availability_zone].destination_cidr_block == "0.0.0.0/0" &&
      aws_route.private_default_routes[availability_zone].nat_gateway_id == aws_nat_gateway.nat_gateways[availability_zone].id
    ])
    error_message = "private subnetのデフォルトルートは、各AZのroute tableから同じAZのNAT Gatewayへ向ける必要があります。"
  }
}

run "public_subnet_associates_with_own_az_route_table" {
  command = apply

  assert {
    condition = alltrue([
      for cidr_block, subnet in aws_subnet.public_subnets :
      aws_route_table_association.public_route_table_associations[cidr_block].subnet_id == subnet.id &&
      aws_route_table_association.public_route_table_associations[cidr_block].route_table_id == aws_route_table.public_route_tables[subnet.availability_zone].id
    ])
    error_message = "各public subnetは、自身の配置先AZに対応するroute tableへ関連付ける必要があります。"
  }
}

run "private_subnet_associates_with_own_az_route_table" {
  command = apply

  assert {
    condition = alltrue([
      for cidr_block, subnet in aws_subnet.private_subnets :
      aws_route_table_association.private_route_table_associations[cidr_block].subnet_id == subnet.id &&
      aws_route_table_association.private_route_table_associations[cidr_block].route_table_id == aws_route_table.private_route_tables[subnet.availability_zone].id
    ])
    error_message = "各private subnetは、自身の配置先AZに対応するroute tableへ関連付ける必要があります。"
  }
}
