terraform {
  required_version = "~> 1.15"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
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

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

locals {
  service_name = "hono-app-${terraform.workspace}"
  base_secret_names = toset([
    "DATABASE_URL", "JWT_SECRET", "REFRESH_TOKEN_SECRET",
    "PASSWORD_RESET_TOKEN_SECRET", "EMAIL_VERIFICATION_TOKEN_SECRET", "RESEND_API_KEY",
  ])
  otlp_secret_names = toset(["OTEL_EXPORTER_OTLP_TRACES_HEADERS"])
  # devではCloud Runへの注入より先に、入れ物と実行用SAの参照権限を用意する。
  secret_names          = terraform.workspace == "dev" ? setunion(local.base_secret_names, local.otlp_secret_names) : local.base_secret_names
  required_secret_names = var.enable_otel_traces ? setunion(local.base_secret_names, local.otlp_secret_names) : local.base_secret_names

  app_environment = merge(var.app_environment == null ? {} : var.app_environment, {
    NODE_ENV            = "production"
    ENABLE_API_DOCS     = tostring(var.enable_api_docs)
    COOKIE_SECURE       = "true"
    OTEL_TRACES_ENABLED = tostring(var.enable_otel_traces)
    OTEL_SDK_DISABLED   = tostring(!var.enable_otel_traces)
    }, var.enable_otel_traces ? {
    OTEL_SERVICE_NAME                  = local.service_name
    OTEL_TRACES_SAMPLER_RATIO          = tostring(var.otel_traces_sampler_ratio)
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = "https://otlp.nr-data.net:4318/v1/traces"
  } : {})
}

resource "google_project_service" "required" {
  for_each = toset([
    "run.googleapis.com", "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com", "iam.googleapis.com", "iap.googleapis.com",
    "monitoring.googleapis.com",
  ])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
