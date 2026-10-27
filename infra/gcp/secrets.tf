resource "google_secret_manager_secret" "app" {
  for_each = local.secret_names

  project   = var.project_id
  secret_id = "${local.service_name}-${lower(replace(each.value, "_", "-"))}"
  replication {
    auto {}
  }

  # 値やsecret versionは管理せず、stateへの機密値の保存を避ける。
  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_iam_member" "runtime" {
  for_each = local.secret_names

  project   = var.project_id
  secret_id = google_secret_manager_secret.app[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}
