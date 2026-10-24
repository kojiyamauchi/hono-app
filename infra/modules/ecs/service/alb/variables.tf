locals {
  alb_name                     = var.service_suffix == "" ? "${var.service_name}-${var.env}-alb" : "${var.service_name}-${var.service_suffix}-${var.env}-alb"
  alb_target_group_name        = "${trimsuffix(local.alb_name, "-alb")}-tg"
  alb_log_bucket_force_destroy = var.env != "prod"
  alb_tags = {
    Name        = local.alb_name
    ServiceName = var.service_name
    Env         = var.env
  }
}

variable "service_name" {
  type        = string
  description = "ALBが所属するサービス名"

  validation {
    condition     = can(regex("^[a-zA-Z0-9][a-zA-Z0-9-]*$", var.service_name))
    error_message = "サービス名は英数字で始め、英数字とハイフンだけを使ってください。"
  }
}

variable "service_suffix" {
  type        = string
  description = "サービス名のサフィックス"
  default     = ""
}

variable "env" {
  type        = string
  description = "環境識別子 (dev, stg, prod)"

  validation {
    condition     = contains(["dev", "stg", "prod"], var.env)
    error_message = "環境はdev、stg、prodのいずれかを指定してください。"
  }
}

variable "alb_vpc_id" {
  type        = string
  description = "ALBのターゲットグループを作成するVPCのID"
}

variable "alb_subnet_ids" {
  type        = list(string)
  description = "異なるAZに配置した2つ以上のpublicサブネットID"

  validation {
    condition     = length(distinct(var.alb_subnet_ids)) >= 2
    error_message = "異なるAZに配置したpublicサブネットを2つ以上指定してください。"
  }
}

variable "alb_security_group_ids" {
  type        = list(string)
  description = "ALBに付与するセキュリティグループIDのリスト"

  validation {
    condition     = length(var.alb_security_group_ids) > 0
    error_message = "ALBのセキュリティグループを1つ以上指定してください。"
  }
}

variable "alb_log_transition_in_days" {
  type        = number
  description = "アクセスログを標準IAへ移行するまでの日数"
  default     = 90

  validation {
    condition     = var.alb_log_transition_in_days >= 30 && floor(var.alb_log_transition_in_days) == var.alb_log_transition_in_days
    error_message = "標準IAへの移行日数は30以上の整数を指定してください。"
  }
}

variable "alb_log_expiration_in_days" {
  type        = number
  description = "アクセスログを削除するまでの日数"
  default     = 550

  validation {
    condition     = var.alb_log_expiration_in_days >= 365 && var.alb_log_expiration_in_days > var.alb_log_transition_in_days && floor(var.alb_log_expiration_in_days) == var.alb_log_expiration_in_days
    error_message = "ログの保持日数は365以上かつ標準IAへの移行日数より大きい整数を指定してください。"
  }
}

variable "alb_enable_http_listener" {
  type        = bool
  description = "HTTPリスナーを有効にするか"
  default     = true

  validation {
    condition     = var.alb_enable_http_listener || var.alb_enable_https_listener
    error_message = "HTTPまたはHTTPSのリスナーを有効にしてください。"
  }
}

variable "alb_enable_https_listener" {
  type        = bool
  description = "HTTPSリスナーを有効にするか"
  default     = false
}

variable "alb_enable_redirect_http_to_https" {
  type        = bool
  description = "HTTPからHTTPSへリダイレクトするか"
  default     = false

  validation {
    condition     = !var.alb_enable_redirect_http_to_https || (var.alb_enable_http_listener && var.alb_enable_https_listener)
    error_message = "HTTPSへリダイレクトするにはHTTPとHTTPSの両リスナーを有効にしてください。"
  }
}

variable "alb_https_certificate_arn" {
  type        = string
  description = "同じリージョンにある発行済みACM証明書のARN。HTTPのみなら省略する"
  default     = null

  validation {
    condition     = !var.alb_enable_https_listener || can(regex("^arn:[^:]+:acm:[^:]+:[0-9]{12}:certificate/.+$", var.alb_https_certificate_arn))
    error_message = "HTTPSリスナーを有効にする場合はACM証明書のARNを指定してください。"
  }
}

variable "alb_https_listener_ssl_policy" {
  type        = string
  description = "HTTPSリスナーのTLSポリシー"
  default     = "ELBSecurityPolicy-TLS13-1-2-2021-06"
}

variable "alb_domain_name" {
  type        = string
  description = "任意の公開ドメイン名。指定しなければDNSレコードを作成しない"
  default     = null
}

variable "alb_hosted_zone_name" {
  type        = string
  description = "公開ドメインを管理する既存Route53のpublicホストゾーン名"
  default     = null

  validation {
    condition     = (var.alb_domain_name == null) == (var.alb_hosted_zone_name == null)
    error_message = "ドメイン名とホストゾーン名は両方指定するか、両方省略してください。"
  }
}

variable "alb_target_group_port" {
  type        = number
  description = "ターゲットグループの転送先ポート番号"
  default     = 80

  validation {
    condition     = var.alb_target_group_port >= 1 && var.alb_target_group_port <= 65535 && floor(var.alb_target_group_port) == var.alb_target_group_port
    error_message = "転送先ポート番号は1から65535までの整数を指定してください。"
  }
}

variable "alb_target_group_deregistration_delay" {
  type        = number
  description = "ターゲット登録解除時に処理中のリクエストの完了を待つ秒数"
  default     = 300

  validation {
    condition     = var.alb_target_group_deregistration_delay >= 0 && var.alb_target_group_deregistration_delay <= 3600 && floor(var.alb_target_group_deregistration_delay) == var.alb_target_group_deregistration_delay
    error_message = "ターゲット登録解除の待機時間は0から3600までの整数を指定してください。"
  }
}

variable "alb_target_group_health_check_port" {
  type        = number
  description = "ヘルスチェックのポート番号。0なら転送先と同じポートを使う"
  default     = 0

  validation {
    condition     = var.alb_target_group_health_check_port >= 0 && var.alb_target_group_health_check_port <= 65535 && floor(var.alb_target_group_health_check_port) == var.alb_target_group_health_check_port
    error_message = "ヘルスチェックポートは0から65535までの整数を指定してください。"
  }
}

variable "alb_target_group_health_check_path" {
  type        = string
  description = "ヘルスチェックのHTTPパス"
  default     = "/"

  validation {
    condition     = startswith(var.alb_target_group_health_check_path, "/")
    error_message = "ヘルスチェックパスは/で始めてください。"
  }
}

variable "alb_target_group_health_check_interval" {
  type        = number
  description = "ヘルスチェックの間隔（秒）"
  default     = 30

  validation {
    condition     = var.alb_target_group_health_check_interval >= 5 && var.alb_target_group_health_check_interval <= 300 && floor(var.alb_target_group_health_check_interval) == var.alb_target_group_health_check_interval
    error_message = "ヘルスチェック間隔は5から300までの整数を指定してください。"
  }
}

variable "alb_target_group_health_check_healthy_threshold" {
  type        = number
  description = "正常と判断する連続成功回数"
  default     = 3

  validation {
    condition     = var.alb_target_group_health_check_healthy_threshold >= 2 && var.alb_target_group_health_check_healthy_threshold <= 10 && floor(var.alb_target_group_health_check_healthy_threshold) == var.alb_target_group_health_check_healthy_threshold
    error_message = "連続成功回数は2から10までの整数を指定してください。"
  }
}

variable "alb_target_group_health_check_unhealthy_threshold" {
  type        = number
  description = "異常と判断する連続失敗回数"
  default     = 3

  validation {
    condition     = var.alb_target_group_health_check_unhealthy_threshold >= 2 && var.alb_target_group_health_check_unhealthy_threshold <= 10 && floor(var.alb_target_group_health_check_unhealthy_threshold) == var.alb_target_group_health_check_unhealthy_threshold
    error_message = "連続失敗回数は2から10までの整数を指定してください。"
  }
}
