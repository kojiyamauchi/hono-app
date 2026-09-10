variable "vpc_cidr_block" {
  type        = string
  default     = "10.0.0.0/16"
  description = "VPCに割り当てるCIDRブロック"

  validation {
    condition     = can(cidrnetmask(var.vpc_cidr_block))
    error_message = "VPCのCIDRブロックはIPv4 CIDR形式で指定してください。"
  }
}

variable "service_name" {
  type        = string
  default     = "hono-app"
  description = "VPCを利用するサービス名を指定"
}

variable "env" {
  type        = string
  default     = "dev"
  description = "環境識別子 (dev, stg, prod)"

  validation {
    condition = contains(
      ["dev", "stg", "prod"],
      var.env
    )
    error_message = "環境はdev、stg、prodのいずれかを指定してください。"
  }
}

variable "vpc_additional_tags" {
  type        = map(string)
  description = "VPCに付与したい追加タグ"
  default     = {}

  validation {
    condition = (
      length(setintersection(keys(var.vpc_additional_tags), ["Name", "Env"])) == 0
    )
    error_message = "キーのNameおよびEnvは予約済みです。使用することはできません。"
  }
}
