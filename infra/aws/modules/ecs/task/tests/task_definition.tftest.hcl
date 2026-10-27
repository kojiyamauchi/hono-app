# AWSをモックし、初期タスク定義と作成後のコンテナ設定変更を検証する。
mock_provider "aws" {}

variables {
  service_name       = "hono-app"
  env                = "dev"
  task_role_arn      = "arn:aws:iam::123456789012:role/hono-app-dev-task-role"
  task_exec_role_arn = "arn:aws:iam::123456789012:role/hono-app-dev-task-exec-role"
}

run "create_initial_task" {
  command = apply

  assert {
    condition = (
      aws_ecs_task_definition.task_definition.family == "hono-app-dev-task" &&
      toset(aws_ecs_task_definition.task_definition.requires_compatibilities) == toset(["FARGATE"]) &&
      aws_ecs_task_definition.task_definition.network_mode == "awsvpc" &&
      aws_ecs_task_definition.task_definition.task_role_arn == var.task_role_arn &&
      aws_ecs_task_definition.task_definition.execution_role_arn == var.task_exec_role_arn
    )
    error_message = "Fargateタスク定義へタスクロールと実行ロールを正しく渡す必要があります。"
  }

  assert {
    condition = (
      jsondecode(aws_ecs_task_definition.task_definition.container_definitions)[0].image == "public.ecr.aws/docker/library/nginx:1.30.6" &&
      jsondecode(aws_ecs_task_definition.task_definition.container_definitions)[0].portMappings[0].containerPort == 80 &&
      jsondecode(aws_ecs_task_definition.task_definition.container_definitions)[0].portMappings[0].hostPort == 80
    )
    error_message = "デフォルトのコンテナ定義は有効なJSONで、正しいポート設定を持つ必要があります。"
  }

  assert {
    condition = (
      output.task_definition_arn == aws_ecs_task_definition.task_definition.arn &&
      output.task_family_name == "hono-app-dev-task"
    )
    error_message = "タスク定義のARNとfamily名を出力する必要があります。"
  }
}

run "updated_image_and_logging_are_planned" {
  command = plan

  variables {
    container_definition = jsonencode([{
      name      = "nginx"
      image     = "nginx:1.22"
      essential = true
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = "hono-app-dev-log-group"
          awslogs-region        = "ap-northeast-1"
          awslogs-stream-prefix = "hono-app"
        }
      }
    }])
  }

  assert {
    condition = (
      jsondecode(aws_ecs_task_definition.task_definition.container_definitions)[0].image == "nginx:1.22" &&
      jsondecode(aws_ecs_task_definition.task_definition.container_definitions)[0].logConfiguration.options["awslogs-group"] == "hono-app-dev-log-group"
    )
    error_message = "作成後のイメージやログ設定の変更を更新計画へ反映する必要があります。"
  }
}
