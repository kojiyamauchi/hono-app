variable "service_name" {
  type        = string
  description = "サービス名"
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

variable "role" {
  type        = string
  description = "リポジトリに格納するイメージのサービス内でのロール"
}

variable "image_tag_mutability" {
  description = <<DESC
  タグの上書きを許容するか否かを指定します。
  - `MUTABLE` 上書き可能
  - `IMMUTABLE` 上書き不可
  DESC
  type        = string
  default     = "MUTABLE"
}

variable "repository_lifecycle_policy" {
  description = <<DESC
  リポジトリのライフサイクルポリシーをJSON形式で指定します。デフォルトでは
  タグのないイメージのうちプッシュから30日以上経過したイメージを削除します。
  空文字を指定した場合はlifecycle_policy/default_policy.jsonを読み込みます。
  参考: https://docs.aws.amazon.com/jp_ja/AmazonECR/latest/userguide/LifecyclePolicy.html
  DESC
  type        = string
  default     = <<-DEFAULT
  {
  "rules": [
    {
      "rulePriority": 1,
      "description": "Expire untagged images older than 30 days",
      "selection": {
        "tagStatus": "untagged",
        "countType": "sinceImagePushed",
        "countUnit": "days",
        "countNumber": 30
      },
      "action": {
        "type": "expire"
      }
    }
  ]
}
DEFAULT
}
