variable "service_name" {
  type        = string
  description = "セキュリティグループが関連するサービス名"
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

variable "vpc_id" {
  type        = string
  description = "セキュリティグループを作成するVPCのID"
}

variable "security_group_ingress_ports" {
  type        = list(number)
  description = "内向き通信(ingress)として許可するポート番号のリストです"
  default     = [80]
}

variable "security_group_ingress_cidrs" {
  type        = list(string)
  description = "内向き通信(ingress)として許可するCIDRのリストです"
  default     = []
}

variable "security_group_ingress_sgs" {
  type        = list(string)
  description = "内向き通信(ingress)との送信元セキュリティグループとして許可するセキュリティグループIDのリストです"
  default     = []
}

variable "security_group_ingress_allow_self" {
  type        = bool
  description = "内向き通信(ingress)として自身のSGを許可するか否かです"
  default     = false
}

variable "security_group_egress_cidrs" {
  type        = list(string)
  description = "外向き通信(egress)として許可する宛先CIDRのリストです"
  default     = []
}

variable "security_group_egress_sgs" {
  type        = list(string)
  description = "外向き通信(egress)として許可する宛先セキュリティグループIDのリストです"
  default     = []
}

locals {
  ingress_cidr_ports = [for v in var.security_group_ingress_ports : tostring(v)]
}

locals {
  ingress_sg_rules = { for v in setproduct(toset(var.security_group_ingress_ports), toset(var.security_group_ingress_sgs)) : join(",", v) => v }
}
