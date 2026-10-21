variable "service_name" {
  type        = string
  description = "サービス名"
}

variable "service_suffix" {
  type        = string
  description = "サービス名のサフィックス (サブサービス名やコンポーネント名)"
  default     = ""
}

variable "env" {
  type        = string
  description = "環境識別子 (dev, stg, prod)"

  validation {
    condition = contains(
      ["dev", "stg", "prod"],
      var.env
    )
    error_message = "環境はdev、stg、prodのいずれかを指定してください。"
  }
}

variable "task_additional_tags" {
  type        = map(string)
  description = "ECSタスク定義に付与する追加リソースタグ"
  default     = {}

  validation {
    condition = (
      length(setintersection(keys(var.task_additional_tags), ["Name", "ServiceName", "Env", "ServiceSuffix"])) == 0
    )
    error_message = "キーのName,ServiceName,EnvおよびServiceSuffixは予約済みです。使用することはできません。"
  }
}


variable "task_cpu_allocation" {
  type        = number
  description = "タスク全体に割り当てるCPU資源量 (1024 = 1vCPU)"
  default     = 1024
}

variable "task_memory_allocation" {
  type        = number
  description = "タスク全体に割り当てるメモリ量 (MB)"
  default     = 2048
}

variable "task_role_arn" {
  type        = string
  description = "タスクロールのARN"
}

variable "task_exec_role_arn" {
  type        = string
  description = "タスク実行ロールのARN"
}

variable "container_definition" {
  type        = string
  description = "タスクのコンテナ定義"
  default     = <<DESC
  [
    {
      "name": "nginx",
      "image": "nginx:1.21",
      "cpu": 1024,
      "memory": 2048,
      "essential": true,
      "portMappings": [
        {
          "containerPort": 80,
          "hostPort": 80
        }
      ]
    }
  ]
  DESC

  validation {
    condition     = can(jsondecode(var.container_definition))
    error_message = "変数container_definitionの値はJSONフォーマットではありません。"
  }
}

locals {
  task_family_name = var.service_suffix == "" ? "${var.service_name}-${var.env}-task" : "${var.service_name}-${var.service_suffix}-${var.env}-task"

  default_tags = var.service_suffix == "" ? {
    ServiceName = var.service_name
    Env         = var.env
    } : {
    ServiceName   = var.service_name
    ServiceSuffix = var.service_suffix
    Env           = var.env
  }

  task_resource_tags = merge(
    {
      Name = local.task_family_name
    },
    var.task_additional_tags,
    local.default_tags
  )
}
