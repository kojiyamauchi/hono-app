# CD基盤も実GCPへ接続せず、権限の用途・信頼条件・初回構築条件を検証する。
mock_provider "google" {
  override_during = plan
  mock_resource "google_service_account" {
    defaults = {
      email = "hono-cd@test-project.iam.gserviceaccount.com"
      name  = "projects/test-project/serviceAccounts/hono-cd@test-project.iam.gserviceaccount.com"
    }
  }
}
mock_provider "google-beta" {}

variables {
  project_id       = "test-project"
  app_image_digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  invoker_members  = ["user:developer@example.com"]
  app_environment = {
    SUPABASE_URL                  = "https://test.supabase.co"
    SUPABASE_PUBLISHABLE_KEY      = "sb_publishable_test"
    ALLOWED_ORIGINS               = "https://example.com"
    PASSWORD_RESET_FROM_EMAIL     = "noreply@example.com"
    PASSWORD_RESET_URL_BASE       = "https://example.com/reset-password"
    EMAIL_VERIFICATION_FROM_EMAIL = "noreply@example.com"
    EMAIL_VERIFICATION_URL_BASE   = "https://example.com/verify-email"
  }
  secret_versions = {
    DATABASE_URL                    = "2"
    JWT_SECRET                      = "1"
    REFRESH_TOKEN_SECRET            = "1"
    PASSWORD_RESET_TOKEN_SECRET     = "1"
    EMAIL_VERIFICATION_TOKEN_SECRET = "1"
    RESEND_API_KEY                  = "1"
  }
}

run "cd_disabled_by_default" {
  command = plan
  assert {
    condition     = length(google_service_account.cd) == 0 && length(google_iam_workload_identity_pool.github) == 0
    error_message = "既存環境へCDの認証基盤を暗黙追加してはいけません。"
  }
}

run "cd_scoped_to_main_and_dev" {
  command = plan
  variables {
    github_cd = {
      repository    = "owner/repository"
      repository_id = "1234"
      owner_id      = "5678"
      state_bucket  = "test-state-bucket"
    }
  }
  assert {
    condition = (
      length(google_service_account.cd) == 3 &&
      google_iam_workload_identity_pool_provider.github[0].oidc[0].issuer_uri == "https://token.actions.githubusercontent.com" &&
      alltrue([for condition in [
        "assertion.repository_id == '1234'", "assertion.repository_owner_id == '5678'",
        "assertion.ref == 'refs/heads/main'", "assertion.event_name == 'push'",
        "assertion.job_workflow_ref == 'owner/repository/.github/workflows/cd-gcp.yml@refs/heads/main'",
      ] : strcontains(google_iam_workload_identity_pool_provider.github[0].attribute_condition, condition)])
    )
    error_message = "GitHubの数値ID・main・push・再利用workflowで信頼範囲を制限する必要があります。"
  }
  assert {
    condition = (
      google_secret_manager_secret_iam_member.cd_database[0].secret_id == "hono-app-dev-database-url" &&
      google_secret_manager_secret_iam_member.cd_database[0].role == "roles/secretmanager.secretAccessor" &&
      google_storage_bucket_iam_member.cd_state[0].bucket == "test-state-bucket" &&
      google_storage_bucket_iam_member.cd_state[0].role == "roles/storage.objectAdmin" &&
      google_artifact_registry_repository_iam_member.cd_push[0].role == "roles/artifactregistry.writer"
    )
    error_message = "DBシークレット・state・イメージ登録先の権限を対象リソースへ限定する必要があります。"
  }
  assert {
    condition = (
      google_project_iam_custom_role.cd_deploy[0].permissions == toset([
        "run.services.get", "run.services.update", "run.services.getIamPolicy", "run.revisions.get",
      ]) &&
      contains(google_project_iam_custom_role.cd_read[0].permissions, "run.operations.get") &&
      alltrue([for permission in google_project_iam_custom_role.cd_read[0].permissions :
        !strcontains(permission, "setIamPolicy") && !strcontains(permission, "access") && !strcontains(permission, "update")
      ]) &&
      contains(google_iap_web_cloud_run_service_iam_binding.users[0].members, "serviceAccount:hono-cd@test-project.iam.gserviceaccount.com")
    )
    error_message = "CDにIAM変更・秘密値の全体取得・Cloud Run作成削除権限を付けてはいけません。検証用SAはIAP内側だけへ許可します。"
  }
}

run "tag_delete_without_image_delete" {
  command = plan
  override_resource {
    target          = google_project_iam_custom_role.cd_tag_delete[0]
    override_during = plan
    values = {
      name = "projects/test-project/roles/honoDevCdTagDelete"
    }
  }
  variables {
    github_cd = {
      repository    = "owner/repository"
      repository_id = "1234"
      owner_id      = "5678"
      state_bucket  = "test-state-bucket"
    }
  }
  assert {
    condition = (
      google_project_iam_custom_role.cd_tag_delete[0].permissions == toset(["artifactregistry.tags.delete"]) &&
      google_artifact_registry_repository_iam_member.cd_tag_delete[0].repository == google_artifact_registry_repository.app.repository_id &&
      google_artifact_registry_repository_iam_member.cd_tag_delete[0].role == google_project_iam_custom_role.cd_tag_delete[0].name
    )
    error_message = "タグ削除権限だけを対象Registryへ付け、イメージ削除権限まで広げてはいけません。"
  }
}

run "reject_cd_before_first_deployment" {
  command = plan
  variables {
    app_image_digest = null
    github_cd = {
      repository    = "owner/repository"
      repository_id = "1234"
      owner_id      = "5678"
      state_bucket  = "test-state-bucket"
    }
  }
  expect_failures = [google_iam_workload_identity_pool.github]
}

run "reject_named_identity_ids" {
  command = plan
  variables {
    github_cd = {
      repository    = "owner/repository"
      repository_id = "repository"
      owner_id      = "owner"
      state_bucket  = "test-state-bucket"
    }
  }
  expect_failures = [var.github_cd]
}
