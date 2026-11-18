variable "app_config" {
  description = "本体専用Workerの設定。nullなら既存検証基盤だけを維持する"
  type = object({
    workers_subdomain = string
    access_issuer     = string
    service_token_id  = string
    enable_worker_url = optional(bool, false)
  })
  default = null

  validation {
    condition = var.app_config == null ? true : (
      can(regex("^[a-z0-9-]+$", var.app_config.workers_subdomain)) &&
      can(regex("^https://[a-z0-9-]+\\.cloudflareaccess\\.com$", var.app_config.access_issuer)) &&
      can(regex("^[0-9a-f-]{36}$", var.app_config.service_token_id))
    )
    error_message = "本体用workers.devサブドメイン、AccessチームのHTTPS Origin、専用サービストークン管理IDを指定してください。"
  }
}

resource "cloudflare_worker" "app" {
  count      = var.app_config == null ? 0 : 1
  account_id = var.account_id
  name       = "hono-app-dev"
  subdomain = {
    enabled          = var.app_config.enable_worker_url
    previews_enabled = false
  }
  observability = { enabled = false }

  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = terraform.workspace == "dev"
      error_message = "本体のCloudflare CDはdevだけを対象とします。"
    }
    precondition {
      condition     = var.access_service_token_id == null ? true : var.app_config.service_token_id != var.access_service_token_id
      error_message = "本体には検証Workerとは別のサービストークンを指定してください。"
    }
  }
}

resource "cloudflare_zero_trust_access_policy" "app_browser" {
  count            = var.app_config == null ? 0 : 1
  account_id       = var.account_id
  name             = "hono-app-dev-browser"
  decision         = "allow"
  session_duration = "8h"
  include          = [for address in sort(tolist(var.allowed_emails)) : { email = { email = address } }]
}

resource "cloudflare_zero_trust_access_policy" "app_automation" {
  count      = var.app_config == null ? 0 : 1
  account_id = var.account_id
  name       = "hono-app-dev-cd"
  decision   = "non_identity"
  include    = [{ service_token = { token_id = var.app_config.service_token_id } }]
}

resource "cloudflare_zero_trust_access_application" "app" {
  count                      = var.app_config == null ? 0 : 1
  account_id                 = var.account_id
  name                       = "hono-app-dev"
  type                       = "self_hosted"
  destinations               = [{ type = "worker", worker_id = cloudflare_worker.app[0].id }]
  allowed_idps               = [local.otp_id]
  auto_redirect_to_identity  = true
  session_duration           = "8h"
  http_only_cookie_attribute = true
  options_preflight_bypass   = false
  policies = [
    { id = cloudflare_zero_trust_access_policy.app_automation[0].id, precedence = 1 },
    { id = cloudflare_zero_trust_access_policy.app_browser[0].id, precedence = 2 },
  ]
  lifecycle { prevent_destroy = true }
}

output "app_cd_config" {
  description = "本体CD用の承認済み設定。APIトークン・DB資格情報・サービストークン実値は含めない"
  value = var.app_config == null ? null : {
    account_id            = var.account_id
    worker_name           = cloudflare_worker.app[0].name
    worker_id             = cloudflare_worker.app[0].id
    hyperdrive_id         = var.hyperdrive_id
    origin                = "https://hono-app-dev.${var.app_config.workers_subdomain}.workers.dev"
    access_issuer         = var.app_config.access_issuer
    access_application_id = cloudflare_zero_trust_access_application.app[0].id
    access_audience       = cloudflare_zero_trust_access_application.app[0].aud
    access_policy_ids     = [cloudflare_zero_trust_access_policy.app_browser[0].id, cloudflare_zero_trust_access_policy.app_automation[0].id]
    allowed_emails        = sort(tolist(var.allowed_emails))
    service_token_id      = var.app_config.service_token_id
    enable_worker_url     = var.app_config.enable_worker_url
  }
}
