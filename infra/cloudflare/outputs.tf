output "worker_id" {
  description = "Accessの保護対象となるWorkerのID"
  value       = cloudflare_worker.compatibility.id
}

output "access_application_id" {
  description = "Worker全体を保護するAccessアプリケーションのID"
  value       = cloudflare_zero_trust_access_application.compatibility.id
}

output "remote_config" {
  description = "Wranglerのremote設定生成用。秘密値・DB接続文字列は含めない"
  value = {
    account_id            = var.account_id
    worker_name           = cloudflare_worker.compatibility.name
    worker_id             = cloudflare_worker.compatibility.id
    hyperdrive_id         = var.hyperdrive_id
    enable_worker_url     = var.enable_worker_url
    access_application_id = cloudflare_zero_trust_access_application.compatibility.id
    automation_enabled    = var.access_service_token_id != null
    access_policy_ids     = concat([for policy in cloudflare_zero_trust_access_policy.automation : policy.id], [cloudflare_zero_trust_access_policy.browser.id])
    observability         = cloudflare_worker.compatibility.observability
  }
}
