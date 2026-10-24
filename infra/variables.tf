variable "subnets" {
  description = "VPC内の同じAZ集合へ1つのAZにつき各1つ作成するpublic/privateサブネットのCIDRと配置先AZ"
  nullable    = false
  type = object({
    public = list(object({
      cidr_block        = string
      availability_zone = string
    }))
    private = list(object({
      cidr_block        = string
      availability_zone = string
    }))
  })
}

variable "excluded_availability_zones" {
  type        = list(string)
  default     = []
  nullable    = false
  description = "サブネットの配置先から除外するAZ名"
}

variable "alb_https_certificate_arn" {
  type        = string
  description = "任意の発行済みACM証明書ARN。指定するとHTTPSとHTTPからのリダイレクトを有効にする"
  default     = null

  validation {
    condition     = var.alb_https_certificate_arn == null || var.alb_domain_name != null
    error_message = "HTTPSで利用する証明書に対応した公開ドメイン名も指定してください。"
  }
}

variable "alb_domain_name" {
  type        = string
  description = "任意の公開ドメイン名。省略時はALBのDNS名でアクセスする"
  default     = null
}

variable "alb_hosted_zone_name" {
  type        = string
  description = "公開ドメインを管理する既存Route53のpublicホストゾーン名"
  default     = null
}
