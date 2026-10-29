output "repository_url" {
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app.repository_id}"
  description = "runtimeイメージの登録先"
}

output "github_cd" {
  value = local.cd_enabled ? {
    provider         = google_iam_workload_identity_pool_provider.github[0].name
    service_accounts = { for name, account in google_service_account.cd : name => account.email }
  } : null
  description = "承認済みの初回構築後に使うWIF名とCD用サービスアカウント。秘密値は含まない"
}

output "service_url" {
  value       = try(google_cloud_run_v2_service.app[0].uri, null)
  description = "IAPで保護されたCloud RunのHTTPS URL。前提リソースだけの作成時はnull"
}

output "secret_ids" {
  value       = { for name, secret in google_secret_manager_secret.app : name => secret.secret_id }
  description = "機密環境変数と登録先シークレットIDの対応。値は含まない"
}

output "runtime_service_account" {
  value       = google_service_account.runtime.email
  description = "Hono実行用のサービスアカウント"
}
