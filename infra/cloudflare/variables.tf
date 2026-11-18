variable "account_id" {
  description = "配備するCloudflareアカウントID"
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.account_id))
    error_message = "account_idには32桁の小文字16進数を指定してください。"
  }
}

variable "hyperdrive_id" {
  description = "手動作成したキャッシュ無効・証明書検証付きHyperdriveのID。接続資格情報は管理しない"
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.hyperdrive_id)) && var.hyperdrive_id != "00000000000000000000000000000000"
    error_message = "実在するHyperdriveの32桁のIDを指定してください。"
  }
}

variable "allowed_emails" {
  description = "Accessのブラウザログインを許可するメールアドレスの完全一致リスト"
  type        = set(string)

  validation {
    condition     = length(var.allowed_emails) > 0 && alltrue([for email in var.allowed_emails : can(regex("^[^@\\s*]+@[^@\\s*]+\\.[^@\\s*]+$", email))])
    error_message = "allowed_emailsにはワイルドカードを含まないメールアドレスを1件以上指定してください。"
  }
}

variable "existing_otp_identity_provider_id" {
  description = "既存のOne-time PINを再利用する場合のID。nullの場合は専用IdPを作成する"
  type        = string
  default     = null

  validation {
    condition     = var.existing_otp_identity_provider_id == null || can(regex("^[0-9a-f-]{36}$", var.existing_otp_identity_provider_id))
    error_message = "既存IdPのIDはUUID形式で指定してください。"
  }
}

variable "access_service_token_id" {
  description = "手動発行した自動検証用サービストークンのID。Client IDやClient Secretではない"
  type        = string
  default     = null

  validation {
    condition     = var.access_service_token_id == null || can(regex("^[0-9a-f-]{36}$", var.access_service_token_id))
    error_message = "サービストークンの管理用IDをUUID形式で指定してください。"
  }
}

variable "enable_worker_url" {
  description = "Accessの初回適用・コード配備・Secret登録後にworkers.dev URLを有効にする"
  type        = bool
  default     = false
}
