terraform {
  required_version = "~> 1.15"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "5.29.0"
    }
  }

  # 既存GCPとは別のprefixを指定する。backendの資格情報はファイルへ記載しない。
  backend "gcs" {}
}

# APIトークンはCLOUDFLARE_API_TOKENから読み込み、tfvarsやstateの入力に含めない。
provider "cloudflare" {}

locals {
  worker_name = "hono-app-${terraform.workspace}-compatibility"
  otp_id      = var.existing_otp_identity_provider_id != null ? var.existing_otp_identity_provider_id : cloudflare_zero_trust_access_identity_provider.otp[0].id
}
