# AZごとに一意なpublic subnetへNAT Gatewayを1つ配置する。
locals {
  public_subnet_cidr_by_az = {
    for subnet in var.subnets.public :
    subnet.availability_zone => subnet.cidr_block
  }
}

resource "aws_eip" "eips" {
  for_each = local.public_subnet_cidr_by_az
  domain   = "vpc"

  tags = {
    Name             = "${var.service_name}-${var.env}-${each.key}-eip"
    Env              = var.env
    AvailabilityZone = each.key
    Usage            = "NAT"
  }
}

resource "aws_nat_gateway" "nat_gateways" {
  for_each      = local.public_subnet_cidr_by_az
  allocation_id = aws_eip.eips[each.key].allocation_id
  subnet_id     = aws_subnet.public_subnets[each.value].id

  depends_on = [aws_internet_gateway.igw]

  tags = {
    Name             = "${var.service_name}-${var.env}-${each.key}-nat-gateway"
    Env              = var.env
    AvailabilityZone = each.key
  }
}
