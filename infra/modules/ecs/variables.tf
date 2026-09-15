variable "service_name" {
  type        = string
  description = "ECSを利用するサービス名"
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

variable "cluster_additional_tags" {
  type        = map(string)
  description = "ECSクラスターに付与したい追加タグ"
  default     = {}

  validation {
    condition = (
      length(setintersection(keys(var.cluster_additional_tags), ["ServiceName", "Env"])) == 0
    )
    error_message = "キーのServiceNameおよびEnvは予約済みです。使用することはできません。"
  }
}
