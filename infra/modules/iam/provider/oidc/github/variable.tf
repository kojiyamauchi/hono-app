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

variable "iam_role_additional_tags" {
  type        = map(string)
  description = "IAMロールに付与する追加タグ"
  default     = {}

  validation {
    condition = (
      length(setintersection(keys(var.iam_role_additional_tags), ["ServiceName", "Env"])) == 0
    )
    error_message = "キーのServiceNameおよびEnvは予約済みです。使用することはできません。"
  }
}

variable "github_organization_name" {
  type = string
}

variable "github_repository_name" {
  type = string
}

variable "managed_iam_policy_arns" {
  type        = list(string)
  description = "AWSまたはユーザー管理IAMポリシーのARNのリスト"
  default     = []
}

variable "inline_policy_documents" {
  type        = map(string)
  description = "ロールに付与するインラインポリシー、ポリシー名をキー、ポリシードキュメントを値として渡します。"
  default     = {}
}
