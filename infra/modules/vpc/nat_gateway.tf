locals {
  public_subnet_cidrs_by_az = {
    for subnet in var.subnets.public :
    subnet.availability_zone => subnet.cidr_block...
  }

  nat_gateway_subnet_cidr_by_az = {
    for availability_zone, cidr_blocks in local.public_subnet_cidrs_by_az :
    availability_zone => sort(cidr_blocks)[0]
  }

  nat_gateway_subnet_id_by_az = {
    for availability_zone, cidr_block in local.nat_gateway_subnet_cidr_by_az :
    availability_zone => aws_subnet.public_subnets[cidr_block].id
  }
}

resource "aws_eip" "eips" {
  for_each = local.nat_gateway_subnet_id_by_az
  domain   = "vpc"

  tags = {
    Name             = "${var.service_name}-${var.env}-${each.key}-eip"
    Env              = var.env
    AvailabilityZone = each.key
    Usage            = "NAT"
  }
}

resource "aws_nat_gateway" "nat_gateways" {
  for_each      = local.nat_gateway_subnet_id_by_az
  allocation_id = aws_eip.eips[each.key].allocation_id
  subnet_id     = each.value

  depends_on = [aws_internet_gateway.igw]

  tags = {
    Name             = "${var.service_name}-${var.env}-${each.key}-nat-gateway"
    Env              = var.env
    AvailabilityZone = each.key
  }
}
