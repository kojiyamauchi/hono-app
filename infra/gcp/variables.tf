variable "project_id" {
  type        = string
  nullable    = false
  description = "課金設定済みの既存GCPプロジェクトID"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "GCPプロジェクトIDを6〜30文字の小文字英数字とハイフンで指定してください。"
  }
}

variable "region" {
  type        = string
  nullable    = false
  default     = "asia-northeast1"
  description = "Cloud RunとArtifact Registryの配置リージョン。既定は東京"
}

variable "app_image_digest" {
  type        = string
  default     = null
  description = "登録済みruntimeイメージのsha256ダイジェスト。未指定時はAPIを起動せず前提リソースだけを作成する"

  validation {
    condition = var.app_image_digest == null ? true : (
      can(regex("^sha256:[0-9a-f]{64}$", var.app_image_digest)) &&
      var.app_image_digest != "sha256:0000000000000000000000000000000000000000000000000000000000000000"
    )
    error_message = "登録済みイメージのsha256ダイジェストを指定してください。ゼロだけのサンプルは使用できません。"
  }
}

variable "app_environment" {
  description = "公開アプリ設定。Supabaseのanonキーは公開キーであり、service roleキーを渡さないこと"
  default     = null
  type = object({
    SUPABASE_URL                  = string
    SUPABASE_ANON_KEY             = string
    ALLOWED_ORIGINS               = string
    PASSWORD_RESET_FROM_EMAIL     = string
    PASSWORD_RESET_URL_BASE       = string
    EMAIL_VERIFICATION_FROM_EMAIL = string
    EMAIL_VERIFICATION_URL_BASE   = string
    COOKIE_SAMESITE               = optional(string, "Lax")
  })

  validation {
    condition = var.app_environment == null ? true : (
      alltrue([for value in values(var.app_environment) : length(trimspace(value)) > 0]) &&
      can(regex("^https://[^/]+/?$", var.app_environment.SUPABASE_URL)) &&
      can(regex("^https://", var.app_environment.PASSWORD_RESET_URL_BASE)) &&
      can(regex("^https://", var.app_environment.EMAIL_VERIFICATION_URL_BASE)) &&
      contains(["Lax", "Strict", "None"], var.app_environment.COOKIE_SAMESITE) &&
      alltrue([for origin in split(",", var.app_environment.ALLOWED_ORIGINS) :
        can(regex("^https?://[^/]+$", trimspace(origin))) && !strcontains(origin, "*")
      ])
    )
    error_message = "公開設定は空にせず、SupabaseとメールのURLはHTTPS、Originはパスやワイルドカードなし、SameSiteはLax・Strict・Noneで指定してください。"
  }
}

variable "secret_versions" {
  type        = map(string)
  nullable    = false
  default     = {}
  description = "機密環境変数とSecret Managerの数値バージョンの対応。実値はTerraformで管理しない"

  validation {
    condition = alltrue([for name, version in var.secret_versions :
      contains(["DATABASE_URL", "JWT_SECRET", "REFRESH_TOKEN_SECRET", "PASSWORD_RESET_TOKEN_SECRET", "EMAIL_VERIFICATION_TOKEN_SECRET", "RESEND_API_KEY"], name) &&
      can(regex("^[1-9][0-9]*$", version))
    ])
    error_message = "対応する6種類の機密環境変数に、latestではなく1以上の数値バージョンを指定してください。"
  }
}

variable "invoker_members" {
  type        = set(string)
  nullable    = false
  default     = []
  description = "API呼び出しを許可するIAM principal。既定は非公開で、許可したユーザー・グループ・サービスアカウントのみ利用できる"

  validation {
    condition     = alltrue([for member in var.invoker_members : can(regex("^(user|group|serviceAccount):[^[:space:]]+@[^[:space:]]+$", member))])
    error_message = "user:メールアドレス、group:メールアドレス、serviceAccount:メールアドレスで指定してください。不特定多数への公開は許可しません。"
  }
}
