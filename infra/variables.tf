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

variable "app_image_digest" {
  type        = string
  nullable    = false
  description = "対象環境のECRへ登録済みのHonoイメージのダイジェスト。タグの付け替えに依存しないよう固定する"

  validation {
    condition = (
      can(regex("^sha256:[0-9a-f]{64}$", var.app_image_digest)) &&
      var.app_image_digest != "sha256:0000000000000000000000000000000000000000000000000000000000000000"
    )
    error_message = "登録済みECRイメージのダイジェストをsha256:に続く64桁の小文字16進数で指定してください。サンプルのゼロだけの値は使用できません。"
  }
}

variable "app_environment" {
  nullable    = false
  description = "Honoへ渡す公開設定。DB接続文字列や署名鍵などの機密値はSSMの参照で渡す"
  type = object({
    SUPABASE_URL                  = string
    ALLOWED_ORIGINS               = string
    PASSWORD_RESET_FROM_EMAIL     = string
    PASSWORD_RESET_URL_BASE       = string
    EMAIL_VERIFICATION_FROM_EMAIL = string
    EMAIL_VERIFICATION_URL_BASE   = string
    COOKIE_SAMESITE               = optional(string, "Lax")
  })

  validation {
    condition     = try(alltrue([for value in values(var.app_environment) : length(trimspace(value)) > 0]), false)
    error_message = "アプリの公開設定はすべて空でない値を指定してください。"
  }

  validation {
    condition     = can(regex("^https://[^/]+/?$", var.app_environment.SUPABASE_URL))
    error_message = "クラウド版SupabaseのプロジェクトURLをHTTPSで指定してください。"
  }

  validation {
    condition = try(alltrue([
      for origin in split(",", var.app_environment.ALLOWED_ORIGINS) :
      can(regex("^https?://[^/]+$", trimspace(origin))) && !strcontains(origin, "*")
    ]), false)
    error_message = "ALLOWED_ORIGINSはワイルドカードやパスを含まないhttp(s)のOriginをカンマ区切りで指定してください。"
  }

  validation {
    condition     = contains(["Lax", "Strict", "None"], var.app_environment.COOKIE_SAMESITE)
    error_message = "COOKIE_SAMESITEはLax・Strict・Noneのいずれかを指定してください。"
  }

  validation {
    condition     = var.app_environment.COOKIE_SAMESITE != "None" || var.alb_https_certificate_arn != null
    error_message = "SameSite=NoneのCookieを使う場合は、HTTPS用の証明書も設定してください。"
  }
}

variable "app_secret_parameter_arns" {
  type        = map(string)
  nullable    = false
  description = "Honoの機密環境変数と既存SSM SecureStringのARNの対応。実値はTerraformの管理対象外"

  validation {
    condition = toset(keys(var.app_secret_parameter_arns)) == toset([
      "DATABASE_URL", "SUPABASE_ANON_KEY", "JWT_SECRET", "REFRESH_TOKEN_SECRET",
      "PASSWORD_RESET_TOKEN_SECRET", "EMAIL_VERIFICATION_TOKEN_SECRET", "RESEND_API_KEY",
    ])
    error_message = "DB・Supabaseキー・JWT・リフレッシュ・パスワード再設定・メール検証・Resendの7つの機密環境変数にSSMのARNを指定してください。"
  }

  validation {
    condition = alltrue([
      for arn in values(var.app_secret_parameter_arns) :
      can(regex("^arn:aws:ssm:ap-northeast-1:${data.aws_caller_identity.current.account_id}:parameter/hono-app/[A-Za-z0-9_./-]+$", arn)) &&
      !strcontains(arn, "*")
    ])
    error_message = "現在のAWSアカウント・東京リージョン・/hono-app/配下のSSMパラメーターARNを指定してください。"
  }
}

variable "excluded_availability_zones" {
  type        = list(string)
  default     = []
  nullable    = false
  description = "サブネットの配置先から除外するAZ名"
}

variable "single_nat_gateway_availability_zone" {
  type        = string
  default     = null
  description = "devでNAT Gatewayを1台へ集約する配置先AZ。nullならAZごとに配置する"

  validation {
    condition     = var.single_nat_gateway_availability_zone == null || terraform.workspace == "dev"
    error_message = "NAT Gatewayの集約はdevだけで利用できます。stg/prodではnullにしてください。"
  }
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
