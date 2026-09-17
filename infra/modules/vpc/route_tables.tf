# public/private subnetがそれぞれ存在するAZの一覧。route tableをAZ単位で作るためのキーに使う。
locals {
  public_availability_zones  = toset([for subnet in var.subnets.public : subnet.availability_zone])
  private_availability_zones = toset([for subnet in var.subnets.private : subnet.availability_zone])
}

# public subnetを配置するAZごとにroute tableを1つ作成する。
# privateがAZごとのNAT Gatewayへ向く構成と対称に保つため、publicもAZ単位へ揃える。
resource "aws_route_table" "public_route_tables" {
  for_each = local.public_availability_zones
  vpc_id   = aws_vpc.vpc.id

  tags = {
    Name             = "${var.service_name}-${var.env}-${each.key}-public-route-table"
    Env              = var.env
    AvailabilityZone = each.key
    Scope            = "public"
  }
}

resource "aws_route" "public_default_routes" {
  for_each       = local.public_availability_zones
  route_table_id = aws_route_table.public_route_tables[each.key].id

  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.igw.id
}

# 各public subnetを、自身の配置先AZに対応するroute tableへ関連付ける。
resource "aws_route_table_association" "public_route_table_associations" {
  for_each       = local.public_subnets_by_cidr
  route_table_id = aws_route_table.public_route_tables[each.value.availability_zone].id
  subnet_id      = aws_subnet.public_subnets[each.key].id
}

# private subnetを配置するAZごとにroute tableを1つ作成する。
resource "aws_route_table" "private_route_tables" {
  for_each = local.private_availability_zones
  vpc_id   = aws_vpc.vpc.id

  tags = {
    Name             = "${var.service_name}-${var.env}-${each.key}-private-route-table"
    Env              = var.env
    AvailabilityZone = each.key
    Scope            = "private"
  }
}

# デフォルトルートは自身のAZのNAT Gatewayへ向ける。他AZのNAT Gatewayへ向けると、
# そのAZの障害が他AZへ波及し、クロスAZのデータ転送料も発生するため。
resource "aws_route" "private_default_routes" {
  for_each       = local.private_availability_zones
  route_table_id = aws_route_table.private_route_tables[each.key].id

  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.nat_gateways[each.key].id
}

# 各private subnetを、自身の配置先AZに対応するroute tableへ関連付ける。
resource "aws_route_table_association" "private_route_table_associations" {
  for_each       = local.private_subnets_by_cidr
  route_table_id = aws_route_table.private_route_tables[each.value.availability_zone].id
  subnet_id      = aws_subnet.private_subnets[each.key].id
}
