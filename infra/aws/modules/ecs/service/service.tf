resource "aws_ecs_service" "service" {
  name = local.ecs_service_name

  launch_type         = "FARGATE"
  scheduling_strategy = "REPLICA"

  cluster = var.ecs_service_cluster_arn

  task_definition = var.ecs_service_task_definition_arn

  desired_count                      = var.ecs_service_task_desired_count
  deployment_maximum_percent         = var.ecs_service_task_maximum_percent
  deployment_minimum_healthy_percent = var.ecs_service_task_minimum_percent

  # ECS Exec用のIAM権限を付けていないため、リモートコマンド実行は無効にする。
  enable_execute_command            = false
  wait_for_steady_state             = true
  health_check_grace_period_seconds = var.ecs_service_enable_load_balancer ? 60 : 0

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.ecs_service_subnets
    security_groups  = var.ecs_service_security_groups
    assign_public_ip = false
  }

  dynamic "load_balancer" {
    # 作成予定のARNから分岐せず、初回planでも確定する入力値でブロック数を決める。
    for_each = var.ecs_service_enable_load_balancer ? [1] : []
    content {
      target_group_arn = var.ecs_service_alb_target_group_arn
      container_name   = var.ecs_service_alb_target_group_container_name
      container_port   = var.ecs_service_alb_target_group_container_port
    }
  }

  deployment_controller {
    type = var.ecs_service_deployment_controller
  }

  lifecycle {
    precondition {
      condition = var.ecs_service_task_desired_count == 0 || (
        floor(var.ecs_service_task_desired_count * var.ecs_service_task_maximum_percent / 100) > var.ecs_service_task_desired_count ||
        ceil(var.ecs_service_task_desired_count * var.ecs_service_task_minimum_percent / 100) < var.ecs_service_task_desired_count
      )
      error_message = "デプロイ時に少なくとも1タスクを追加または停止できる割合を指定してください。"
    }
  }

  tags = local.ecs_service_tags
}
