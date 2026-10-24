terraform {
  required_version = "~> 1.15"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  backend "s3" {
    bucket       = "terraform-state-hono-app"
    encrypt      = true
    key          = "hono-app/terraform.tfstate"
    region       = "ap-northeast-1"
    use_lockfile = true
  }
}

provider "aws" {
  region = local.region
}

module "vpc" {
  source = "./modules/vpc"

  service_name                = local.service_name
  env                         = terraform.workspace
  vpc_cidr_block              = "10.0.0.0/16"
  subnets                     = var.subnets
  excluded_availability_zones = var.excluded_availability_zones
  vpc_additional_tags = {
    Usage = "hono web server"
  }
}

module "ecs_cluster" {
  source       = "./modules/ecs"
  service_name = local.service_name
  env          = terraform.workspace
}

module "ecr_web" {
  source       = "./modules/ecr"
  service_name = local.service_name
  env          = terraform.workspace
  role         = "web"
}

module "log_group" {
  source       = "./modules/cloudwatch/logs"
  service_name = local.service_name
  env          = terraform.workspace
}

module "task" {
  source             = "./modules/ecs/task"
  service_name       = local.service_name
  env                = terraform.workspace
  task_role_arn      = module.roles.task_role_arn
  task_exec_role_arn = module.roles.task_exec_role_arn
  # ロググループへ出力するコンテナ定義を渡す。
  container_definition = local.container_definitions
}

module "roles" {
  source       = "./modules/ecs/iam/roles"
  service_name = local.service_name
  env          = terraform.workspace

  task_exec_role_ecr_repository_arns = [module.ecr_web.repository_arn]
  task_exec_role_log_group_arns      = [module.log_group.log_group_arn]
}

module "alb" {
  source       = "./modules/ecs/service/alb"
  service_name = local.service_name
  env          = terraform.workspace

  alb_subnet_ids = values(module.vpc.public_subnets)
  alb_security_group_ids = [
    module.alb_security_group.security_group_id
  ]
  alb_enable_https_listener             = var.alb_https_certificate_arn != null
  alb_enable_redirect_http_to_https     = var.alb_https_certificate_arn != null
  alb_https_certificate_arn             = var.alb_https_certificate_arn
  alb_domain_name                       = var.alb_domain_name
  alb_hosted_zone_name                  = var.alb_hosted_zone_name
  alb_target_group_port                 = local.web_container_port
  alb_target_group_deregistration_delay = terraform.workspace == "dev" ? 30 : 300
  alb_vpc_id                            = module.vpc.vpc_id

  # internet-facing ALBの作成前に、Internet Gatewayと経路も用意する。
  depends_on = [module.vpc]
}

module "ecs_service" {
  source       = "./modules/ecs/service/"
  service_name = local.service_name
  env          = terraform.workspace

  ecs_service_cluster_arn = module.ecs_cluster.cluster_arn

  ecs_service_subnets = values(module.vpc.private_subnets)
  ecs_service_security_groups = [
    module.ecs_security_group.security_group_id
  ]
  ecs_service_task_definition_arn = module.task.task_definition_arn

  ecs_service_alb_target_group_arn            = module.alb.alb_target_group_arn
  ecs_service_alb_target_group_container_name = local.web_container_name
  ecs_service_alb_target_group_container_port = local.web_container_port

  # リスナー・NAT経路・IAMポリシー・通信ルールが揃ってからタスクを起動する。
  depends_on = [
    module.alb,
    module.vpc,
    module.roles,
    aws_vpc_security_group_ingress_rule.ecs_from_alb,
    aws_vpc_security_group_egress_rule.alb_to_ecs,
  ]
}
