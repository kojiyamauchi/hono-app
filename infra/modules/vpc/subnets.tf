# CIDRをリソースのキーに保ち、入力順や取得したAZ一覧の変化で配置先を変えない。
resource "aws_subnet" "public_subnets" {
  for_each   = { for subnet in var.subnets.public : subnet.cidr_block => subnet }
  cidr_block = each.key
  vpc_id     = aws_vpc.vpc.id

  availability_zone = each.value.availability_zone

  tags = merge(var.subnet_additional_tags,
    {
      Name             = "${var.service_name}-${var.env}-${each.value.availability_zone}-public-subnet"
      Env              = var.env
      Scope            = "public"
      AvailabilityZone = each.value.availability_zone
  })
}

resource "aws_subnet" "private_subnets" {
  for_each   = { for subnet in var.subnets.private : subnet.cidr_block => subnet }
  cidr_block = each.key
  vpc_id     = aws_vpc.vpc.id

  availability_zone = each.value.availability_zone

  tags = merge(var.subnet_additional_tags,
    {
      Name             = "${var.service_name}-${var.env}-${each.value.availability_zone}-private-subnet"
      Env              = var.env
      Scope            = "private"
      AvailabilityZone = each.value.availability_zone
  })
}
