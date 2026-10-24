# rootでECRの権限とコンテナのログ出力先への配線を確認する。
mock_provider "aws" {
  mock_resource "aws_alb" {
    defaults = {
      arn      = "arn:aws:elasticloadbalancing:ap-northeast-1:123456789012:loadbalancer/app/test/1234567890123456"
      dns_name = "test-alb.ap-northeast-1.elb.amazonaws.com"
      zone_id  = "Z1234567890"
    }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  mock_resource "aws_ecs_cluster" {
    defaults = { arn = "arn:aws:ecs:ap-northeast-1:123456789012:cluster/root-cluster" }
  }
  mock_resource "aws_ecs_task_definition" {
    defaults = { arn = "arn:aws:ecs:ap-northeast-1:123456789012:task-definition/root-task:7" }
  }
  mock_resource "aws_alb_target_group" {
    defaults = { arn = "arn:aws:elasticloadbalancing:ap-northeast-1:123456789012:targetgroup/root/1234567890123456" }
  }
}

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
    arn            = "arn:aws:ecr:ap-northeast-1:123456789012:repository/hono-app-dev-web"
    id             = "hono-app-dev-web"
    region         = "ap-northeast-1"
    repository_url = "123456789012.dkr.ecr.ap-northeast-1.amazonaws.com/hono-app-dev-web"
    registry_id    = "123456789012"
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

# 初回planではリソースIDが未確定でも、SGルールとALB連携を計画できる必要がある。
run "initial_http_plan" {
  command = plan
  assert {
    condition = (
      aws_vpc_security_group_ingress_rule.ecs_from_alb.from_port == 80 &&
      aws_vpc_security_group_egress_rule.alb_to_ecs.to_port == 80 &&
      output.ecs_service_name == "hono-app-dev-service"
    )
    error_message = "リソースIDが未確定の初回planでも、ECSサービスとALBからの通信を計画できる必要があります。"
  }
}

run "http_service_wiring" {
  command = apply
  assert {
    condition = (
      aws_vpc_security_group_ingress_rule.ecs_from_alb.security_group_id == module.ecs_security_group.security_group_id &&
      aws_vpc_security_group_ingress_rule.ecs_from_alb.referenced_security_group_id == module.alb_security_group.security_group_id &&
      aws_vpc_security_group_ingress_rule.ecs_from_alb.from_port == local.web_container_port &&
      aws_vpc_security_group_egress_rule.alb_to_ecs.security_group_id == module.alb_security_group.security_group_id &&
      aws_vpc_security_group_egress_rule.alb_to_ecs.referenced_security_group_id == module.ecs_security_group.security_group_id &&
      aws_vpc_security_group_egress_rule.alb_to_ecs.to_port == local.web_container_port &&
      output.alb_url == "http://${module.alb.alb_fqdn}" &&
      output.ecs_service_name == "hono-app-dev-service"
    )
    error_message = "公開URLはHTTPのALBを指し、ALBとECSのSG間でコンテナのポートだけを許可する必要があります。"
  }
}

run "https_public_url" {
  command = apply
  variables {
    alb_https_certificate_arn = "arn:aws:acm:ap-northeast-1:123456789012:certificate/test"
    alb_domain_name           = "dev.example.com"
    alb_hosted_zone_name      = "example.com"
  }
  assert {
    condition     = output.alb_url == "https://dev.example.com"
    error_message = "証明書とドメインを指定した場合、公開URLは指定ドメインのHTTPSになる必要があります。"
  }
}

run "https_requires_public_domain" {
  command = plan
  variables {
    alb_https_certificate_arn = "arn:aws:acm:ap-northeast-1:123456789012:certificate/test"
  }
  expect_failures = [var.alb_https_certificate_arn]
}
