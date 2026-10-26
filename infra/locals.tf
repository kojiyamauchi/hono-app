locals {
  service_name       = "hono-app"
  region             = "ap-northeast-1"
  web_container_name = "hono"
  web_container_port = 3000

  # devは最小構成を使い、コンテナとタスク全体の割り当てを一致させる。
  task_cpu_allocation       = terraform.workspace == "dev" ? 256 : 1024
  task_memory_allocation    = terraform.workspace == "dev" ? 512 : 2048
  enable_container_insights = terraform.workspace != "dev"
  log_retention_in_days     = terraform.workspace == "dev" ? 7 : 30

  # イメージはダイジェストで固定し、同じ設定から同じ成果物を起動できるようにする。
  application_image = "${module.ecr_web.repository_url}@${var.app_image_digest}"
  app_environment = merge(var.app_environment, {
    NODE_ENV                           = "production"
    PORT                               = tostring(local.web_container_port)
    ENABLE_API_DOCS                    = "false"
    COOKIE_SECURE                      = tostring(var.alb_https_certificate_arn != null || terraform.workspace != "dev")
    OTEL_TRACES_ENABLED                = tostring(var.otel_traces.enabled)
    OTEL_SERVICE_NAME                  = "${local.service_name}-${terraform.workspace}"
    OTEL_TRACES_SAMPLER_RATIO          = tostring(var.otel_traces.sampling_ratio)
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = var.otel_traces.endpoint
  })
  app_secret_parameter_arns = merge(var.app_secret_parameter_arns,
    var.otel_traces.enabled && var.otel_traces.headers_parameter_arn != null ? {
      OTEL_EXPORTER_OTLP_TRACES_HEADERS = var.otel_traces.headers_parameter_arn
  } : {})

  container_definitions = jsonencode([
    {
      name      = local.web_container_name
      image     = local.application_image
      cpu       = local.task_cpu_allocation
      memory    = local.task_memory_allocation
      essential = true
      environment = [for name, value in local.app_environment : {
        name  = name
        value = value
      }]
      # 機密値はTerraformへ渡さず、起動時に実行ロールでSSMから取得する。
      secrets = [for name, arn in local.app_secret_parameter_arns : {
        name      = name
        valueFrom = arn
      }]
      portMappings = [
        {
          containerPort = local.web_container_port
          hostPort      = local.web_container_port
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = module.log_group.log_group_name
          awslogs-region        = local.region
          awslogs-stream-prefix = local.service_name
        }
      }
    }
  ])
}
