# rootでECR権限・ログ出力・ALBとECSサービスの接続を確認する。
mock_provider "aws" {
  mock_resource "aws_lb" {
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
  mock_resource "aws_lb_target_group" {
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
  app_image_digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  app_environment = {
    SUPABASE_URL                  = "https://example.supabase.co"
    ALLOWED_ORIGINS               = "http://localhost:3000"
    PASSWORD_RESET_FROM_EMAIL     = "noreply@example.com"
    PASSWORD_RESET_URL_BASE       = "https://example.com/reset-password"
    EMAIL_VERIFICATION_FROM_EMAIL = "noreply@example.com"
    EMAIL_VERIFICATION_URL_BASE   = "https://example.com/verify-email"
  }
  app_secret_parameter_arns = {
    for name in [
      "DATABASE_URL", "SUPABASE_ANON_KEY", "JWT_SECRET", "REFRESH_TOKEN_SECRET",
      "PASSWORD_RESET_TOKEN_SECRET", "EMAIL_VERIFICATION_TOKEN_SECRET", "RESEND_API_KEY",
    ] : name => "arn:aws:ssm:ap-northeast-1:123456789012:parameter/hono-app/dev/${name}"
  }
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
      aws_vpc_security_group_ingress_rule.ecs_from_alb.from_port == 3000 &&
      aws_vpc_security_group_egress_rule.alb_to_ecs.to_port == 3000 &&
      output.ecs_service_name == "hono-app-${terraform.workspace}-service"
    )
    error_message = "リソースIDが未確定の初回planでも、ECSサービスとALBからの通信を計画できる必要があります。"
  }
}

run "hono_runtime_configuration" {
  command = plan

  assert {
    condition = (
      jsondecode(local.container_definitions)[0].name == "hono" &&
      jsondecode(local.container_definitions)[0].image == "123456789012.dkr.ecr.ap-northeast-1.amazonaws.com/hono-app-dev-web@${var.app_image_digest}" &&
      jsondecode(local.container_definitions)[0].portMappings[0].containerPort == 3000 &&
      tomap({ for entry in jsondecode(local.container_definitions)[0].environment : entry.name => entry.value }) == tomap(local.app_environment) &&
      tomap({ for entry in jsondecode(local.container_definitions)[0].secrets : entry.name => entry.valueFrom }) == var.app_secret_parameter_arns &&
      !contains([for entry in jsondecode(local.container_definitions)[0].environment : entry.name], "DATABASE_URL") &&
      local.app_environment.COOKIE_SECURE == (terraform.workspace == "dev" ? "false" : "true") &&
      local.app_environment.ENABLE_API_DOCS == "false"
    )
    error_message = "HonoをECRの固定ダイジェスト・3000番ポートで起動し、公開設定とSSM参照を分離する必要があります。"
  }
}

run "mutable_image_tag_is_rejected" {
  command = plan
  variables {
    app_image_digest = "latest"
  }
  expect_failures = [var.app_image_digest]
}

run "trace_export_uses_parameter_store_headers" {
  command = plan
  variables {
    otel_traces = {
      enabled               = true
      headers_parameter_arn = "arn:aws:ssm:ap-northeast-1:123456789012:parameter/hono-app/dev/OTEL_EXPORTER_OTLP_TRACES_HEADERS"
      sampling_ratio        = 0.25
    }
  }
  assert {
    condition = (
      local.app_environment.OTEL_TRACES_ENABLED == "true" &&
      local.app_environment.OTEL_TRACES_SAMPLER_RATIO == "0.25" &&
      local.app_environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT == "https://otlp.nr-data.net:4318/v1/traces" &&
      local.app_secret_parameter_arns.OTEL_EXPORTER_OTLP_TRACES_HEADERS == var.otel_traces.headers_parameter_arn &&
      length(jsondecode(local.container_definitions)[0].secrets) == 8 &&
      !contains(keys(local.app_environment), "OTEL_EXPORTER_OTLP_TRACES_HEADERS")
    )
    error_message = "trace送信は明示的な有効化時だけ設定し、機密ヘッダーを公開設定へ入れずSSM参照として追加してください。"
  }
}

run "disabled_tracing_does_not_request_header_permissions" {
  command = plan
  variables {
    otel_traces = {
      headers_parameter_arn = "arn:aws:ssm:ap-northeast-1:123456789012:parameter/hono-app/dev/OTEL_EXPORTER_OTLP_TRACES_HEADERS"
    }
  }
  assert {
    condition = (
      local.app_environment.OTEL_TRACES_ENABLED == "false" &&
      !contains(keys(local.app_secret_parameter_arns), "OTEL_EXPORTER_OTLP_TRACES_HEADERS")
    )
    error_message = "trace送信が無効な場合、ヘッダー用パラメーターへの取得権限を追加しないでください。"
  }
}

run "trace_export_requires_headers_parameter" {
  command = plan
  variables {
    otel_traces = { enabled = true }
  }
  expect_failures = [var.otel_traces]
}

run "trace_export_rejects_wildcard_parameter" {
  command = plan
  variables {
    otel_traces = {
      enabled               = true
      headers_parameter_arn = "arn:aws:ssm:ap-northeast-1:123456789012:parameter/hono-app/dev/*"
    }
  }
  expect_failures = [var.otel_traces]
}

run "placeholder_image_digest_is_rejected" {
  command = plan
  variables {
    app_image_digest = "sha256:0000000000000000000000000000000000000000000000000000000000000000"
  }
  expect_failures = [var.app_image_digest]
}

run "missing_application_secret_is_rejected" {
  command = plan
  variables {
    app_secret_parameter_arns = {
      JWT_SECRET = "arn:aws:ssm:ap-northeast-1:123456789012:parameter/hono-app/dev/JWT_SECRET"
    }
  }
  expect_failures = [var.app_secret_parameter_arns]
}

run "wildcard_origin_is_rejected" {
  command = plan
  variables {
    app_environment = merge(var.app_environment, { ALLOWED_ORIGINS = "*" })
  }
  expect_failures = [var.app_environment]
}

run "cross_site_cookie_requires_https" {
  command = plan
  variables {
    app_environment = merge(var.app_environment, { COOKIE_SAMESITE = "None" })
  }
  expect_failures = [var.app_environment]
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
      output.ecs_service_name == "hono-app-${terraform.workspace}-service"
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

# workspaceごとに実行し、devの省コスト設定がstg/prodへ波及しないことを確認する。
run "workspace_cost_configuration" {
  command = plan

  assert {
    condition = (
      local.task_cpu_allocation == (terraform.workspace == "dev" ? 256 : 1024) &&
      local.task_memory_allocation == (terraform.workspace == "dev" ? 512 : 2048) &&
      jsondecode(local.container_definitions)[0].cpu == local.task_cpu_allocation &&
      jsondecode(local.container_definitions)[0].memory == local.task_memory_allocation &&
      local.enable_container_insights == (terraform.workspace != "dev") &&
      local.log_retention_in_days == (terraform.workspace == "dev" ? 7 : 30)
    )
    error_message = "devだけを小さなタスク・Insights無効・7日ログ保持とし、stg/prodの従来設定とコンテナの割り当てを維持する必要があります。"
  }
}
