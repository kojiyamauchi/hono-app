# rootでECRリポジトリとIAMポリシーの依存関係を確認する。
mock_provider "aws" {}

override_data {
  target = data.aws_iam_openid_connect_provider.github
  values = {
    arn = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
  }
}

override_data {
  target = module.vpc.data.aws_availability_zones.availability_zone
  values = {
    names = ["ap-northeast-1a", "ap-northeast-1c"]
  }
}

override_resource {
  target          = module.ecr_web.aws_ecr_repository.repository
  override_during = plan
  values = {
    arn = "arn:aws:ecr:ap-northeast-1:123456789012:repository/hono-app-dev-web"
  }
}

variables {
  subnets = {
    public = [
      { cidr_block = "10.0.0.0/24", availability_zone = "ap-northeast-1a" },
      { cidr_block = "10.0.1.0/24", availability_zone = "ap-northeast-1c" },
    ]
    private = [
      { cidr_block = "10.0.2.0/24", availability_zone = "ap-northeast-1a" },
      { cidr_block = "10.0.3.0/24", availability_zone = "ap-northeast-1c" },
    ]
  }
}

run "ecr_push_policy_uses_repository_arn" {
  command = plan

  assert {
    condition = (
      jsondecode(local.ecr_web_push_policy).Statement[0].Action == "ecr:GetAuthorizationToken" &&
      jsondecode(local.ecr_web_push_policy).Statement[0].Resource == "*" &&
      contains(jsondecode(local.ecr_web_push_policy).Statement[1].Action, "ecr:PutImage") &&
      jsondecode(local.ecr_web_push_policy).Statement[1].Resource == "arn:aws:ecr:ap-northeast-1:123456789012:repository/hono-app-dev-web"
    )
    error_message = "ECR push権限は作成するリポジトリのARNに限定する必要があります。"
  }
}
