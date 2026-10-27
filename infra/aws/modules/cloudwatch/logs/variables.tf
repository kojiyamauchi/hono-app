variable "service_name" {
  type        = string
  description = "ロググループが関連するサービス名"
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

variable "log_group_additional_tags" {
  type        = map(string)
  description = "ロググループに付与する追加タグ"
  default     = {}

  validation {
    condition = (
      length(setintersection(keys(var.log_group_additional_tags), ["Name", "ServiceName", "Env", "ServiceSuffix"])) == 0
    )
    error_message = "キーのName,ServiceName,EnvおよびServiceSuffixは予約済みです。使用することはできません。"
  }
}

variable "log_retention_in_days" {
  description = "ロググループにログを保持する期間です"
  type        = number
  default     = 30
}

locals {
  log_group_name = var.service_suffix == "" ? "${var.service_name}-${var.env}-log-group" : "${var.service_name}-${var.service_suffix}-${var.env}-log-group"
  default_resource_tags = var.service_suffix == "" ? {
    Name        = local.log_group_name
    ServiceName = var.service_name
    Env         = var.env
    } : {
    Name          = local.log_group_name
    ServiceName   = var.service_name
    ServiceSuffix = var.service_suffix
    Env           = var.env
  }

  log_group_tags = merge(
    var.log_group_additional_tags,
    local.default_resource_tags
  )

}
