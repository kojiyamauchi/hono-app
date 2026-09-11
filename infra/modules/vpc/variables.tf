variable "vpc_cidr_block" {
  type        = string
  default     = "10.0.0.0/16"
  description = "VPCに割り当てるCIDRブロック"

  validation {
    condition = (
      can(cidrnetmask(var.vpc_cidr_block)) &&
      can(regex("/(1[6-9]|2[0-8])$", var.vpc_cidr_block)) &&
      try(cidrsubnet(var.vpc_cidr_block, 0, 0) == var.vpc_cidr_block, false)
    )
    error_message = "VPCのCIDRブロックは/16〜/28のネットワークアドレスをIPv4 CIDR形式で指定してください。"
  }
}

variable "service_name" {
  type        = string
  description = "VPCを利用するサービス名を指定"
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

variable "subnets" {
  description = "public/privateサブネットのCIDRと配置先AZ。それぞれ2個以上かつ同数で指定し、各種別を2つ以上のAZへ分散する"
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

  validation {
    condition     = try(length(var.subnets.public) >= 2, false)
    error_message = "publicサブネットのCIDRブロックは2個以上指定してください。"
  }

  validation {
    condition     = try(length(var.subnets.private) >= 2, false)
    error_message = "privateサブネットのCIDRブロックは2個以上指定してください。"
  }

  validation {
    condition     = try(length(var.subnets.public) == length(var.subnets.private), false)
    error_message = "public/privateサブネットのCIDRブロックは同数で指定してください。"
  }

  validation {
    condition = try(alltrue([
      for subnet in concat(var.subnets.public, var.subnets.private) :
      can(cidrnetmask(subnet.cidr_block)) &&
      can(regex("/(1[6-9]|2[0-8])$", subnet.cidr_block)) &&
      try(cidrsubnet(subnet.cidr_block, 0, 0) == subnet.cidr_block, false)
    ]), false)
    error_message = "各サブネットは/16〜/28のネットワークアドレスをIPv4 CIDR形式で指定してください。public/privateのリスト、各要素、CIDRにnullは指定できません。"
  }

  validation {
    # VPCのプレフィックスでネットワークアドレスを比較し、サブネットのサイズも確認する。
    condition = try(alltrue([
      for subnet in concat(var.subnets.public, var.subnets.private) :
      tonumber(split("/", subnet.cidr_block)[1]) >= tonumber(split("/", var.vpc_cidr_block)[1]) &&
      cidrhost("${split("/", subnet.cidr_block)[0]}/${split("/", var.vpc_cidr_block)[1]}", 0) == cidrhost(var.vpc_cidr_block, 0)
    ]), false)
    error_message = "各サブネットのCIDRブロックはVPCのCIDRブロック内に収まる範囲で指定してください。"
  }

  validation {
    # 全ペアを双方向に比較し、完全一致とプレフィックス長が異なる包含関係を検出する。
    condition = try(alltrue(flatten([
      for i, subnet in concat(var.subnets.public, var.subnets.private) : [
        for j, other in concat(var.subnets.public, var.subnets.private) :
        cidrhost("${split("/", other.cidr_block)[0]}/${split("/", subnet.cidr_block)[1]}", 0) != cidrhost(subnet.cidr_block, 0)
        if i != j
      ]
    ])), false)
    error_message = "public/private全体でサブネットのCIDRブロックが重ならないように指定してください。"
  }

  validation {
    condition = try(alltrue([
      for subnet in concat(var.subnets.public, var.subnets.private) :
      length(trimspace(subnet.availability_zone)) > 0 &&
      subnet.availability_zone == trimspace(subnet.availability_zone)
    ]), false)
    error_message = "各サブネットの配置先AZは空文字・null・前後の空白を含まない名前で指定してください。"
  }

  validation {
    condition = try(alltrue([
      for subnets in [var.subnets.public, var.subnets.private] :
      length(distinct([for subnet in subnets : subnet.availability_zone])) >= 2
    ]), false)
    error_message = "public/privateサブネットは、それぞれ2つ以上の異なるAZへ配置してください。"
  }

  validation {
    condition = try(alltrue([
      for subnet in concat(var.subnets.public, var.subnets.private) :
      contains(data.aws_availability_zones.availability_zone.names, subnet.availability_zone)
    ]), false)
    error_message = "配置先AZは、対象リージョンで利用可能かつ除外対象ではないAZを指定してください。"
  }
}
