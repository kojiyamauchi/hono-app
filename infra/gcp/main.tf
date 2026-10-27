terraform {
  required_version = "~> 1.15"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
  }

  # バケットは事前作成し、env/backend.local.hclで指定する。AWSのstateとは共有しない。
  backend "gcs" {}
}

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  service_name = "hono-app-${terraform.workspace}"
  secret_names = toset([
    "DATABASE_URL", "JWT_SECRET", "REFRESH_TOKEN_SECRET",
    "PASSWORD_RESET_TOKEN_SECRET", "EMAIL_VERIFICATION_TOKEN_SECRET", "RESEND_API_KEY",
  ])
  app_environment = merge(var.app_environment == null ? {} : var.app_environment, {
    NODE_ENV            = "production"
    ENABLE_API_DOCS     = "false"
    COOKIE_SECURE       = "true"
    OTEL_TRACES_ENABLED = "false"
    OTEL_SDK_DISABLED   = "true"
  })
}

resource "google_project_service" "required" {
  for_each = toset([
    "run.googleapis.com", "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com", "iam.googleapis.com",
  ])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
