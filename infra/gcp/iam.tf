resource "google_service_account" "runtime" {
  project      = var.project_id
  account_id   = "${local.service_name}-runtime"
  display_name = "Hono実行用。対象シークレットの読み取りだけを許可"

  depends_on = [google_project_service.required]
}

// サービスエージェントはIAPの初回利用時に明示的に生成する。
resource "google_project_service_identity" "iap" {
  provider = google-beta
  count    = var.app_image_digest == null ? 0 : 1
  project  = var.project_id
  service  = "iap.googleapis.com"

  depends_on = [google_project_service.required]
}

// Cloud Runへの呼び出しはIAPだけに許可し、利用者はIAP側の権限で管理する。
resource "google_cloud_run_v2_service_iam_binding" "invoker" {
  count = var.app_image_digest == null ? 0 : 1

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.app[0].name
  role     = "roles/run.invoker"
  members  = ["serviceAccount:${google_project_service_identity.iap[0].email}"]
}

// サービス単位のIAP権限を一括管理し、手動で追加された許可対象もplanで検出する。
resource "google_iap_web_cloud_run_service_iam_binding" "users" {
  count = var.app_image_digest == null ? 0 : 1

  project                = var.project_id
  location               = var.region
  cloud_run_service_name = google_cloud_run_v2_service.app[0].name
  role                   = "roles/iap.httpsResourceAccessor"
  members                = var.invoker_members

  depends_on = [google_cloud_run_v2_service_iam_binding.invoker]
}
