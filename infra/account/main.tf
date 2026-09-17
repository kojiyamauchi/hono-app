terraform {
  required_version = "~> 1.15"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    http = {
      source  = "hashicorp/http"
      version = "~> 3.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }

  backend "s3" {
    bucket       = "terraform-state-hono-app"
    encrypt      = true
    key          = "hono-app/account/terraform.tfstate"
    region       = "ap-northeast-1"
    use_lockfile = true
  }
}

provider "aws" {
  region = "ap-northeast-1"
}

locals {
  github_oidc_url = "https://token.actions.githubusercontent.com"
}

data "http" "openid_configuration" {
  url = "${local.github_oidc_url}/.well-known/openid-configuration"
}

data "tls_certificate" "github_jwks" {
  url = jsondecode(data.http.openid_configuration.response_body).jwks_uri
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = local.github_oidc_url
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github_jwks.certificates[0].sha1_fingerprint]
}

output "github_oidc_provider_arn" {
  value       = aws_iam_openid_connect_provider.github.arn
  description = "GitHub Actions用OIDCプロバイダーのARN"
}
