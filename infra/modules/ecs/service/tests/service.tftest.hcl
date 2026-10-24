# AWSへの通信を行わず、タスク定義とALBの接続、および更新時の挙動を確認する。
mock_provider "aws" {}

variables {
  service_name                                = "hono-app"
  env                                         = "dev"
  ecs_service_cluster_arn                     = "arn:aws:ecs:ap-northeast-1:123456789012:cluster/test-cluster"
  ecs_service_task_definition_arn             = "arn:aws:ecs:ap-northeast-1:123456789012:task-definition/test-task:7"
  ecs_service_subnets                         = ["subnet-11111111", "subnet-22222222"]
  ecs_service_security_groups                 = ["sg-12345678"]
  ecs_service_alb_target_group_arn            = "arn:aws:elasticloadbalancing:ap-northeast-1:123456789012:targetgroup/test/1234567890123456"
  ecs_service_alb_target_group_container_name = "web"
  ecs_service_alb_target_group_container_port = 8080
}

run "private_fargate_service" {
  command = plan

  assert {
    condition = (
      aws_ecs_service.service.cluster == var.ecs_service_cluster_arn &&
      aws_ecs_service.service.task_definition == var.ecs_service_task_definition_arn &&
      aws_ecs_service.service.launch_type == "FARGATE" &&
      aws_ecs_service.service.desired_count == 1 &&
      !one(aws_ecs_service.service.network_configuration).assign_public_ip &&
      one(aws_ecs_service.service.network_configuration).subnets == toset(var.ecs_service_subnets) &&
      one(aws_ecs_service.service.network_configuration).security_groups == toset(var.ecs_service_security_groups)
    )
    error_message = "指定したクラスターとタスク定義で、public IPを持たないFargateタスクを維持する必要があります。"
  }

  assert {
    condition = (
      one(aws_ecs_service.service.load_balancer).target_group_arn == var.ecs_service_alb_target_group_arn &&
      one(aws_ecs_service.service.load_balancer).container_name == "web" &&
      one(aws_ecs_service.service.load_balancer).container_port == 8080 &&
      aws_ecs_service.service.health_check_grace_period_seconds == 60
    )
    error_message = "ALBの転送先は指定したコンテナ名とポートへ接続する必要があります。"
  }

  assert {
    condition = (
      one(aws_ecs_service.service.deployment_circuit_breaker).enable &&
      one(aws_ecs_service.service.deployment_circuit_breaker).rollback &&
      aws_ecs_service.service.wait_for_steady_state &&
      !aws_ecs_service.service.enable_execute_command &&
      aws_ecs_service.service.deployment_maximum_percent == 200 &&
      aws_ecs_service.service.deployment_minimum_healthy_percent == 100
    )
    error_message = "失敗時はロールバックし、1タスク構成でも追加タスクを起動して更新できる必要があります。"
  }
}

run "without_load_balancer" {
  command = plan
  variables {
    ecs_service_enable_load_balancer = false
    ecs_service_alb_target_group_arn = ""
  }
  assert {
    condition     = length(aws_ecs_service.service.load_balancer) == 0 && aws_ecs_service.service.health_check_grace_period_seconds == 0
    error_message = "ALB連携が無効なら転送先の登録とヘルスチェック猶予を設定しない必要があります。"
  }
}

run "missing_target_group" {
  command = plan
  variables { ecs_service_alb_target_group_arn = "" }
  expect_failures = [var.ecs_service_alb_target_group_arn]
}

run "blocked_rollout" {
  command = plan
  variables { ecs_service_task_maximum_percent = 100 }
  expect_failures = [aws_ecs_service.service]
}

run "negative_task_count" {
  command = plan
  variables { ecs_service_task_desired_count = -1 }
  expect_failures = [var.ecs_service_task_desired_count]
}

run "unsupported_deployment_controller" {
  command = plan
  variables { ecs_service_deployment_controller = "CODE_DEPLOY" }
  expect_failures = [var.ecs_service_deployment_controller]
}

run "empty_subnets" {
  command = plan
  variables { ecs_service_subnets = [] }
  expect_failures = [var.ecs_service_subnets]
}
