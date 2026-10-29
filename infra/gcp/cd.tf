# 初回は人がplanを確認して適用する。CD自身にはIAM・WIFの変更権限を渡さない。
locals {
  cd_enabled  = var.github_cd != null
  cd_accounts = local.cd_enabled ? toset(["deploy", "migration", "verify"]) : toset([])
  cd_read_permissions = [
    "artifactregistry.repositories.get", "artifactregistry.repositories.getIamPolicy",
    "iam.roles.get", "iam.serviceAccounts.get", "iam.serviceAccounts.getIamPolicy",
    "iam.workloadIdentityPools.get", "iam.workloadIdentityPools.getAttestationRules",
    "iam.workloadIdentityPoolProviders.get",
    "iap.webServices.getIamPolicy", "resourcemanager.projects.get", "resourcemanager.projects.getIamPolicy",
    "secretmanager.secrets.get", "secretmanager.secrets.getIamPolicy",
    "serviceusage.services.get", "serviceusage.services.list", "storage.buckets.getIamPolicy",
    "run.operations.get",
  ]
}

resource "google_project_service" "cd" {
  for_each           = local.cd_enabled ? toset(["sts.googleapis.com", "iamcredentials.googleapis.com", "cloudresourcemanager.googleapis.com"]) : toset([])
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_service_account" "cd" {
  for_each     = local.cd_accounts
  project      = var.project_id
  account_id   = "${local.service_name}-cd-${each.key}"
  display_name = "GitHub Actions dev配備用: ${each.key}"
  depends_on   = [google_project_service.cd]
}

resource "google_iam_workload_identity_pool" "github" {
  count                     = local.cd_enabled ? 1 : 0
  project                   = var.project_id
  workload_identity_pool_id = "${local.service_name}-github"
  display_name              = "Hono dev GitHub Actions"
  depends_on                = [google_project_service.cd]
  lifecycle {
    precondition {
      condition     = terraform.workspace == "dev" && var.app_image_digest != null
      error_message = "CDは配備済みのdev環境だけで有効化してください。"
    }
  }
}

resource "google_iam_workload_identity_pool_provider" "github" {
  count                              = local.cd_enabled ? 1 : 0
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github[0].workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  attribute_mapping = {
    "google.subject"          = "assertion.sub"
    "attribute.repository_id" = "assertion.repository_id"
  }
  # 数値IDに加え、対象workflowのmainへのpushとdev Environmentだけを受け入れる。
  attribute_condition = join(" && ", [
    "assertion.repository_id == '${var.github_cd.repository_id}'",
    "assertion.repository_owner_id == '${var.github_cd.owner_id}'",
    "assertion.ref == 'refs/heads/main'",
    "assertion.event_name == 'push'",
    "assertion.workflow_ref == '${var.github_cd.repository}/.github/workflows/cd-gcp.yml@refs/heads/main'",
    "assertion.environment == 'gcp-dev'",
  ])
  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "cd_federation" {
  for_each           = local.cd_accounts
  service_account_id = google_service_account.cd[each.key].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github[0].name}/attribute.repository_id/${var.github_cd.repository_id}"
}

resource "google_project_iam_custom_role" "cd_read" {
  count       = local.cd_enabled ? 1 : 0
  project     = var.project_id
  role_id     = "honoDevCdRead"
  title       = "Hono dev CD read"
  description = "Terraform全体planのrefresh用。秘密値とIAM更新を許可しない"
  permissions = local.cd_read_permissions
}

resource "google_project_iam_member" "cd_read" {
  count   = local.cd_enabled ? 1 : 0
  project = var.project_id
  role    = google_project_iam_custom_role.cd_read[0].name
  member  = "serviceAccount:${google_service_account.cd["deploy"].email}"
}

resource "google_cloud_run_v2_service_iam_member" "cd_deploy" {
  count    = local.cd_enabled && var.app_image_digest != null ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.app[0].name
  role     = google_project_iam_custom_role.cd_deploy[0].name
  member   = "serviceAccount:${google_service_account.cd["deploy"].email}"
}

resource "google_project_iam_custom_role" "cd_deploy" {
  count       = local.cd_enabled ? 1 : 0
  project     = var.project_id
  role_id     = "honoDevCdDeploy"
  title       = "Hono dev CD deploy"
  description = "既存Cloud Runの更新と状態確認だけ。作成・削除・IAM変更を許可しない"
  permissions = ["run.services.get", "run.services.update", "run.services.getIamPolicy", "run.revisions.get"]
}

resource "google_service_account_iam_member" "cd_runtime" {
  count              = local.cd_enabled ? 1 : 0
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.cd["deploy"].email}"
}

resource "google_artifact_registry_repository_iam_member" "cd_push" {
  count      = local.cd_enabled ? 1 : 0
  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.app.repository_id
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.cd["deploy"].email}"
}

resource "google_storage_bucket_iam_member" "cd_state" {
  count  = local.cd_enabled ? 1 : 0
  bucket = var.github_cd.state_bucket
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.cd["deploy"].email}"
}

# writerにはタグ削除がないため、イメージ削除まで広げず対象Registryへ追加する。
resource "google_project_iam_custom_role" "cd_tag_delete" {
  count       = local.cd_enabled ? 1 : 0
  project     = var.project_id
  role_id     = "honoDevCdTagDelete"
  title       = "Hono dev CD tag delete"
  description = "release保護タグと候補タグの削除だけ。イメージ自体の削除は許可しない"
  permissions = ["artifactregistry.tags.delete"]
}

resource "google_artifact_registry_repository_iam_member" "cd_tag_delete" {
  count      = local.cd_enabled ? 1 : 0
  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.app.repository_id
  role       = google_project_iam_custom_role.cd_tag_delete[0].name
  member     = "serviceAccount:${google_service_account.cd["deploy"].email}"
}

resource "google_secret_manager_secret_iam_member" "cd_database" {
  count     = local.cd_enabled ? 1 : 0
  project   = var.project_id
  secret_id = google_secret_manager_secret.app["DATABASE_URL"].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cd["migration"].email}"
}
