resource "google_service_account" "runtime" {
  project      = var.project_id
  account_id   = "${local.service_name}-runtime"
  display_name = "Hono実行用。対象シークレットの読み取りだけを許可"

  depends_on = [google_project_service.required]
}

resource "google_cloud_run_v2_service_iam_member" "invoker" {
  for_each = var.app_image_digest == null ? toset([]) : var.invoker_members

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.app[0].name
  role     = "roles/run.invoker"
  member   = each.value
}
