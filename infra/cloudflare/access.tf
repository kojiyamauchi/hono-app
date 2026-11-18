resource "cloudflare_zero_trust_access_identity_provider" "otp" {
  count      = var.existing_otp_identity_provider_id == null ? 1 : 0
  account_id = var.account_id
  name       = "${local.worker_name}-email"
  type       = "onetimepin"
  config     = {}
}

resource "cloudflare_zero_trust_access_policy" "browser" {
  account_id       = var.account_id
  name             = "${local.worker_name}-browser"
  decision         = "allow"
  session_duration = "8h"
  include          = [for address in sort(tolist(var.allowed_emails)) : { email = { email = address } }]
}

resource "cloudflare_zero_trust_access_policy" "automation" {
  count      = var.access_service_token_id == null ? 0 : 1
  account_id = var.account_id
  name       = "${local.worker_name}-automation"
  decision   = "non_identity"
  include    = [{ service_token = { token_id = var.access_service_token_id } }]
}

resource "cloudflare_zero_trust_access_application" "compatibility" {
  account_id                 = var.account_id
  name                       = local.worker_name
  type                       = "self_hosted"
  destinations               = [{ type = "worker", worker_id = cloudflare_worker.compatibility.id }]
  allowed_idps               = [local.otp_id]
  auto_redirect_to_identity  = true
  session_duration           = "8h"
  http_only_cookie_attribute = true
  options_preflight_bypass   = false

  # ブラウザと自動検証を別のポリシーにし、Bearer用AuthorizationをAccessへ転用しない。
  policies = concat(
    [for policy in cloudflare_zero_trust_access_policy.automation : { id = policy.id, precedence = 1 }],
    [{ id = cloudflare_zero_trust_access_policy.browser.id, precedence = 2 }],
  )
}
