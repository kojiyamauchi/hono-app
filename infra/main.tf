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

  service_name   = "hono-app"
  env            = terraform.workspace
  vpc_cidr_block = "10.0.0.0/16"
  vpc_additional_tags = {
    Usage = "hono web server"
  }
}
