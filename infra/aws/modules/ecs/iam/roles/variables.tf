variable "service_name" {
  type        = string
  description = "IAMロールが関連するサービス名"
}

variable "task_role_additional_tags" {
  type        = map(string)
  description = "タスクロールに付与する追加タグ"
  default     = {}

  validation {
    condition     = length(setintersection(keys(var.task_role_additional_tags), ["Name", "ServiceName", "Env"])) == 0
    error_message = "キーのName,ServiceNameおよびEnvは予約済みです。使用することはできません。"
  }
}

variable "task_exec_role_additional_tags" {
  type        = map(string)
  description = "タスク実行ロールに付与する追加タグ"
  default     = {}

  validation {
    condition     = length(setintersection(keys(var.task_exec_role_additional_tags), ["Name", "ServiceName", "Env"])) == 0
    error_message = "キーのName,ServiceNameおよびEnvは予約済みです。使用することはできません。"
  }
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

variable "task_exec_role_ecr_repository_arns" {
  type        = list(string)
  nullable    = false
  description = "実行ロールによるイメージ取得を許可するECRリポジトリARN"

  validation {
    condition = length(var.task_exec_role_ecr_repository_arns) > 0 && alltrue([
      for arn in var.task_exec_role_ecr_repository_arns :
      can(regex("^arn:[^:]+:ecr:[^:]+:[0-9]{12}:repository/.+$", arn)) && !strcontains(arn, "*")
    ])
    error_message = "ワイルドカードを含まないECRリポジトリARNを1件以上指定してください。"
  }
}

variable "task_exec_role_log_group_arns" {
  type        = list(string)
  nullable    = false
  description = "実行ロールによるログ送信を許可するロググループARN（末尾の:*を含めない）"

  validation {
    condition = length(var.task_exec_role_log_group_arns) > 0 && alltrue([
      for arn in var.task_exec_role_log_group_arns :
      can(regex("^arn:[^:]+:logs:[^:]+:[0-9]{12}:log-group:.+$", arn)) && !strcontains(arn, "*")
    ])
    error_message = "ワイルドカードを含まないロググループARNを1件以上指定してください。"
  }
}

variable "task_role_managed_policy_arns" {
  description = "タスクロールに付与する管理ポリシーARNのリストを指定します"
  type        = list(string)
  default     = []

  validation {
    condition     = length(var.task_role_managed_policy_arns) <= 10
    error_message = "添付できる管理対象ポリシーの数は、最大10件までです。"
  }
}

variable "task_exec_role_ssm_parameter_arns" {
  type        = list(string)
  default     = []
  nullable    = false
  description = "環境変数へ注入する既存SSM SecureStringのARN。既定のaws/ssmキーを使用する"

  validation {
    condition = alltrue([
      for arn in var.task_exec_role_ssm_parameter_arns :
      can(regex("^arn:[^:]+:ssm:[^:]+:[0-9]{12}:parameter/.+$", arn)) && !strcontains(arn, "*")
    ])
    error_message = "ワイルドカードを含まないSSMパラメーターARNを指定してください。"
  }
}

variable "task_role_inline_policies" {
  description = <<DESC
  タスクロールに付与するインラインポリシーです。キーにインラインポリシー名、値にインラインポリシーのボディ(JSON)を記述します。
  DESC
  type        = map(string)
  default     = {}
}
