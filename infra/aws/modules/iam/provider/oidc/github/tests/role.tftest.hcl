# AWSリソースを作成せず、GitHubのmainブランチへの信頼条件を確認する。
mock_provider "aws" {}

variables {
  service_name             = "hono-app"
  env                      = "dev"
  github_organization_name = "kojiyamauchi"
  github_repository_name   = "hono-app"
  oidc_provider_arn        = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
  inline_policy_documents = {
    "hono-app-dev-ecr-web-push" = jsonencode({
      Version = "2012-10-17"
      Statement = [
        {
          Effect   = "Allow"
          Action   = "ecr:GetAuthorizationToken"
          Resource = "*"
        },
        {
          Effect   = "Allow"
          Action   = ["ecr:PutImage", "ecr:UploadLayerPart"]
          Resource = "arn:aws:ecr:ap-northeast-1:123456789012:repository/hono-app-dev-web"
        }
      ]
    })
  }
}

run "main_only_trust" {
  command = plan

  assert {
    condition = (
      aws_iam_role.role.name == "hono-app-dev-role" &&
      jsondecode(aws_iam_role.role.assume_role_policy).Statement[0].Principal.Federated == var.oidc_provider_arn &&
      jsondecode(aws_iam_role.role.assume_role_policy).Statement[0].Action == "sts:AssumeRoleWithWebIdentity" &&
      jsondecode(aws_iam_role.role.assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"] == "repo:kojiyamauchi/hono-app:ref:refs/heads/main" &&
      jsondecode(aws_iam_role.role.assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:aud"] == "sts.amazonaws.com"
    )
    error_message = "IAMロールは指定したOIDCプロバイダーからmainブランチだけを受け入れる必要があります。"
  }
}
