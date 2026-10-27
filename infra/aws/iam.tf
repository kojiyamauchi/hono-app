data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

locals {
  ecr_web_push_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:CompleteLayerUpload",
          "ecr:InitiateLayerUpload",
          "ecr:PutImage",
          "ecr:UploadLayerPart",
        ]
        Resource = module.ecr_web.repository_arn
      },
    ]
  })
}

module "github_ecr_push" {
  source = "./modules/iam/provider/oidc/github"

  service_name             = local.service_name
  env                      = terraform.workspace
  github_organization_name = "kojiyamauchi"
  github_repository_name   = "hono-app"
  oidc_provider_arn        = data.aws_iam_openid_connect_provider.github.arn
  inline_policy_documents = {
    "${local.service_name}-${terraform.workspace}-ecr-web-push" = local.ecr_web_push_policy
  }
}
