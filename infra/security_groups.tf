module "alb_security_group" {
  source       = "./modules/vpc/security_group"
  service_name = "${local.service_name}-alb"
  env          = terraform.workspace
  vpc_id       = module.vpc.vpc_id

  security_group_ingress_ports = var.alb_https_certificate_arn != null ? [80, 443] : [80]
  security_group_ingress_cidrs = ["0.0.0.0/0"]
}

module "ecs_security_group" {
  source       = "./modules/vpc/security_group"
  service_name = "${local.service_name}-ecs"
  env          = terraform.workspace
  vpc_id       = module.vpc.vpc_id

  # privateサブネットからNAT経由でイメージ取得とログ送信を行う。
  security_group_egress_cidrs = ["0.0.0.0/0"]
}

# SGのIDをfor_eachのキーに使わず、初回planでも確定する独立したルールを作る。
resource "aws_vpc_security_group_ingress_rule" "ecs_from_alb" {
  security_group_id            = module.ecs_security_group.security_group_id
  referenced_security_group_id = module.alb_security_group.security_group_id
  ip_protocol                  = "tcp"
  from_port                    = local.web_container_port
  to_port                      = local.web_container_port
}

resource "aws_vpc_security_group_egress_rule" "alb_to_ecs" {
  security_group_id            = module.alb_security_group.security_group_id
  referenced_security_group_id = module.ecs_security_group.security_group_id
  ip_protocol                  = "tcp"
  from_port                    = local.web_container_port
  to_port                      = local.web_container_port
}
