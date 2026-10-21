# rootでECRの権限とコンテナのログ出力先への配線を確認する。
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

# ECRプッシュ権限の検証対象外であるECS用IAMロールは、出力だけをモックする。
override_module {
  target = module.roles
  outputs = {
    task_role_arn      = "arn:aws:iam::123456789012:role/hono-app-dev-task-role"
    task_exec_role_arn = "arn:aws:iam::123456789012:role/hono-app-dev-task-exec-role"
  }
}

# 固定文字列の直書きでは通らないよう、ロググループの出力を別名に置き換える。
override_module {
  target = module.log_group
  outputs = {
    log_group_name = "root-wiring-test-logs"
    log_group_arn  = "arn:aws:logs:ap-northeast-1:123456789012:log-group:root-wiring-test-logs"
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

run "container_logs_use_log_group_output" {
  command = plan

  assert {
    condition = (
      jsondecode(local.container_definitions)[0].logConfiguration.logDriver == "awslogs" &&
      jsondecode(local.container_definitions)[0].logConfiguration.options["awslogs-group"] == module.log_group.log_group_name &&
      jsondecode(local.container_definitions)[0].logConfiguration.options["awslogs-group"] == "root-wiring-test-logs" &&
      jsondecode(local.container_definitions)[0].logConfiguration.options["awslogs-region"] == local.region &&
      jsondecode(local.container_definitions)[0].logConfiguration.options["awslogs-stream-prefix"] == local.service_name
    )
    error_message = "コンテナのログ設定はロググループの出力と共通リージョンを参照する必要があります。"
  }
}
