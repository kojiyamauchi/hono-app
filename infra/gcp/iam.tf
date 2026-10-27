resource "google_service_account" "runtime" {
  project      = var.project_id
  account_id   = "${local.service_name}-runtime"
  display_name = "Hono実行用。対象シークレットの読み取りだけを許可"

  depends_on = [google_project_service.required]
}

// サービス単位の呼び出し権限を一括管理し、手動追加された公開権限もplanで検出する。
resource "google_cloud_run_v2_service_iam_binding" "invoker" {
  count = var.app_image_digest == null ? 0 : 1

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.app[0].name
  role     = "roles/run.invoker"
  members  = var.invoker_members
}
