locals {
  ecs_service_name = var.service_suffix == "" ? "${var.service_name}-${var.env}-service" : "${var.service_name}-${var.service_suffix}-${var.env}-service"
  ecs_service_tags = {
    Name        = local.ecs_service_name
    ServiceName = var.service_name
    Env         = var.env
  }
}

variable "service_name" {
  type        = string
  description = "ECSサービスが構成するサービス名"
}

variable "service_suffix" {
  type        = string
  description = "サービス名のサフィックス"
  default     = ""
}

variable "env" {
  type        = string
  description = "環境識別子 (dev, stg, prod)"

  validation {
    condition     = contains(["dev", "stg", "prod"], var.env)
    error_message = "環境はdev、stg、prodのいずれかを指定してください。"
  }
}

variable "ecs_service_cluster_arn" {
  type        = string
  description = "ECSサービスが所属するECSクラスターのARN"
}

variable "ecs_service_task_definition_arn" {
  type        = string
  description = "ECSサービスで実行するタスク定義のARN"
}

variable "ecs_service_subnets" {
  type        = list(string)
  description = "ECSサービスの所属するサブネットIDのリスト"

  validation {
    condition     = length(var.ecs_service_subnets) > 0
    error_message = "タスクを配置するサブネットを1つ以上指定してください。"
  }
}

variable "ecs_service_security_groups" {
  type        = list(string)
  description = "ECSサービスに付与するセキュリティグループIDのリスト"
}

variable "ecs_service_alb_target_group_arn" {
  type        = string
  description = "ECSサービスに付与するALBターゲットグループのARN"
  default     = ""

  validation {
    condition     = !var.ecs_service_enable_load_balancer || var.ecs_service_alb_target_group_arn != ""
    error_message = "ALB連携を有効にする場合はターゲットグループのARNを指定してください。"
  }
}

variable "ecs_service_enable_load_balancer" {
  type        = bool
  description = "ALBのターゲットグループへタスクを登録するか"
  default     = true
}

variable "ecs_service_alb_target_group_container_name" {
  type        = string
  description = "ターゲットグループへ登録するコンテナ名"
  default     = "nginx"
}

variable "ecs_service_alb_target_group_container_port" {
  type        = number
  description = "ターゲットグループへ登録するコンテナのポート番号"
  default     = 80

  validation {
    condition     = var.ecs_service_alb_target_group_container_port >= 1 && var.ecs_service_alb_target_group_container_port <= 65535 && floor(var.ecs_service_alb_target_group_container_port) == var.ecs_service_alb_target_group_container_port
    error_message = "コンテナのポート番号は1から65535までの整数を指定してください。"
  }
}

variable "ecs_service_task_desired_count" {
  type        = number
  description = "維持するタスク数"
  default     = 1

  validation {
    condition     = var.ecs_service_task_desired_count >= 0 && floor(var.ecs_service_task_desired_count) == var.ecs_service_task_desired_count
    error_message = "タスク数は0以上の整数を指定してください。"
  }
}

variable "ecs_service_task_maximum_percent" {
  type        = number
  description = "デプロイ時のタスク数の上限割合"
  default     = 200

  validation {
    condition     = var.ecs_service_task_maximum_percent >= 100 && var.ecs_service_task_maximum_percent <= 200 && floor(var.ecs_service_task_maximum_percent) == var.ecs_service_task_maximum_percent
    error_message = "タスク数の上限割合は100から200までの整数を指定してください。"
  }
}

variable "ecs_service_task_minimum_percent" {
  type        = number
  description = "デプロイ中に正常稼働させるタスク数の下限割合"
  default     = 100

  validation {
    condition     = var.ecs_service_task_minimum_percent >= 0 && var.ecs_service_task_minimum_percent <= 100 && floor(var.ecs_service_task_minimum_percent) == var.ecs_service_task_minimum_percent
    error_message = "正常稼働タスク数の下限割合は0から100までの整数を指定してください。"
  }
}

variable "ecs_service_deployment_controller" {
  type        = string
  description = "デプロイコントローラー。このモジュールはECSのローリング更新に対応する"
  default     = "ECS"

  validation {
    condition     = var.ecs_service_deployment_controller == "ECS"
    error_message = "このモジュールはECSのローリング更新のみ対応しています。"
  }
}
