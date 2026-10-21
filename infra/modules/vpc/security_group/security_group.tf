locals {
  security_group_name = "${var.service_name}-${var.env}-sg"
  security_group_tags = {
    Name        = local.security_group_name
    ServiceName = var.service_name
    Env         = var.env
  }
}

resource "aws_security_group" "security_group" {
  name        = local.security_group_name
  description = "${local.security_group_name} security group"
  vpc_id      = var.vpc_id
  tags        = local.security_group_tags
}

resource "aws_vpc_security_group_ingress_rule" "ingress_cidr_security_group_rules" {
  for_each          = local.ingress_cidr_rules
  security_group_id = aws_security_group.security_group.id
  ip_protocol       = "tcp"
  from_port         = each.value[0]
  to_port           = each.value[0]
  cidr_ipv4         = each.value[1]
}

resource "aws_vpc_security_group_ingress_rule" "ingress_sg_security_group_rules" {
  for_each                     = local.ingress_sg_rules
  security_group_id            = aws_security_group.security_group.id
  ip_protocol                  = "tcp"
  from_port                    = each.value[0]
  to_port                      = each.value[0]
  referenced_security_group_id = each.value[1]
}

resource "aws_vpc_security_group_ingress_rule" "ingress_self_security_group_rules" {
  for_each                     = var.security_group_ingress_allow_self ? toset(local.ingress_ports) : toset([])
  security_group_id            = aws_security_group.security_group.id
  ip_protocol                  = "tcp"
  from_port                    = each.value
  to_port                      = each.value
  referenced_security_group_id = aws_security_group.security_group.id
}

resource "aws_vpc_security_group_egress_rule" "security_group_rule_egress" {
  for_each          = toset(var.security_group_egress_cidrs)
  security_group_id = aws_security_group.security_group.id
  ip_protocol       = "-1"
  cidr_ipv4         = each.value
}

resource "aws_vpc_security_group_egress_rule" "security_group_rule_egress_sgs" {
  for_each                     = toset(var.security_group_egress_sgs)
  security_group_id            = aws_security_group.security_group.id
  ip_protocol                  = "-1"
  referenced_security_group_id = each.value
}
