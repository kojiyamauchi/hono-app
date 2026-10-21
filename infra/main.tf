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
  region = "ap-northeast-1"
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
