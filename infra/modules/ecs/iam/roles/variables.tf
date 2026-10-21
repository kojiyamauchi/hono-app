variable "service_name" {
  type        = string
  description = "IAMロールが関連するサービス名"
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

variable "task_role_managed_policy_arns" {
  description = "タスクロールに付与する管理ポリシーARNのリストを指定します"
  type        = list(string)
  default     = []

  validation {
    condition     = length(var.task_role_managed_policy_arns) <= 10
    error_message = "添付できる管理対象ポリシーの数は、最大10件までです。"
  }
}

variable "task_role_inline_policies" {
  description = <<DESC
  タスクロールに付与するインラインポリシーです。キーにインラインポリシー名、値にインラインポリシーのボディ(JSON)を記述します。
  DESC
  type        = map(string)
  default     = {}
}
