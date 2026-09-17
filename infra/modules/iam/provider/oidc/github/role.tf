locals {
  iam_role_tags = merge(var.iam_role_additional_tags,
    {
      ServiceName = var.service_name
      Env         = var.env
  })
}

locals {
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = var.oidc_provider_arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_organization_name}/${var.github_repository_name}:ref:refs/heads/main"
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
      }
    }]
  })
}

resource "aws_iam_role" "role" {
  name               = "${var.service_name}-${var.env}-role"
  assume_role_policy = local.assume_role_policy
  tags               = local.iam_role_tags
}
