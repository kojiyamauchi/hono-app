resource "cloudflare_worker" "compatibility" {
  account_id = var.account_id
  name       = local.worker_name

  subdomain = {
    enabled          = var.enable_worker_url
    previews_enabled = false
  }

  observability = {
    enabled            = true
    head_sampling_rate = 1
    logs = {
      enabled         = true
      invocation_logs = true
    }
  }

  lifecycle {
    prevent_destroy = true

    precondition {
      condition     = terraform.workspace == "dev"
      error_message = "今回の共有Supabaseへの検証配備はdev workspaceだけを使用してください。"
    }
  }
}
