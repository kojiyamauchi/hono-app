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

resource "aws_vpc" "vpc" {
  cidr_block = var.vpc_cidr_block

  tags = merge(
    var.vpc_additional_tags,
    {
      Name = "${var.service_name}-${var.env}-vpc"
      Env  = var.env
    }
  )
}
