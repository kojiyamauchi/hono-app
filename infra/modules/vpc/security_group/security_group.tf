locals {
  security_group_name = "${var.service_name}-${var.env}-sg"
  security_group_tags = {
    Name        = local.security_group_name
    ServiceName = var.service_name
    Env         = var.env
  }
}

resource "aws_security_group" "security_group" {
  name   = local.security_group_name
  vpc_id = var.vpc_id
  tags   = local.security_group_tags
}

resource "aws_security_group_rule" "ingress_cidr_security_group_rules" {
  for_each          = length(var.security_group_ingress_cidrs) > 0 ? toset(local.ingress_ports) : toset([])
  security_group_id = aws_security_group.security_group.id
  type              = "ingress"
  protocol          = "TCP"
  from_port         = each.value
  to_port           = each.value
  cidr_blocks       = var.security_group_ingress_cidrs
}

resource "aws_security_group_rule" "ingress_sg_security_group_rules" {
  for_each                 = local.ingress_sg_rules
  type                     = "ingress"
  security_group_id        = aws_security_group.security_group.id
  protocol                 = "TCP"
  from_port                = each.value[0]
  to_port                  = each.value[0]
  source_security_group_id = each.value[1]
}

resource "aws_security_group_rule" "ingress_self_security_group_rules" {
  for_each          = var.security_group_ingress_allow_self ? toset(local.ingress_ports) : toset([])
  security_group_id = aws_security_group.security_group.id
  type              = "ingress"
  protocol          = "TCP"
  from_port         = each.value
  to_port           = each.value
  self              = true
}

resource "aws_security_group_rule" "security_group_rule_egress" {
  count = length(var.security_group_egress_cidrs) > 0 ? 1 : 0

  security_group_id = aws_security_group.security_group.id
  type              = "egress"
  protocol          = "-1"
  from_port         = 0
  to_port           = 0
  cidr_blocks       = var.security_group_egress_cidrs
}

resource "aws_security_group_rule" "security_group_rule_egress_sgs" {
  for_each                 = toset(var.security_group_egress_sgs)
  security_group_id        = aws_security_group.security_group.id
  type                     = "egress"
  protocol                 = "-1"
  from_port                = 0
  to_port                  = 0
  source_security_group_id = each.value
}
