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

variable "repository_additional_tags" {
  type        = map(string)
  description = "ECRリポジトリに付与したい追加タグ"
  default     = {}

  validation {
    condition = (
      length(setintersection(keys(var.repository_additional_tags), ["ServiceName", "Env"])) == 0
    )
    error_message = "キーのServiceNameおよびEnvは予約済みです。使用することはできません。"
  }
}

variable "image_tag_mutability" {
  description = <<DESC
  タグの上書きを許容するか否かを指定します。
  - `MUTABLE` 上書き可能
  - `IMMUTABLE` 上書き不可
  DESC
  type        = string
  default     = "MUTABLE"

  validation {
    condition = contains(
      ["MUTABLE", "IMMUTABLE"],
      var.image_tag_mutability
    )
    error_message = "タグの上書き可否はMUTABLEまたはIMMUTABLEを指定してください。"
  }
}

variable "repository_lifecycle_policy" {
  description = <<DESC
  リポジトリのライフサイクルポリシーをJSON形式で指定します。デフォルトでは
  タグのないイメージのうちプッシュから30日以上経過したイメージを削除し、
  main-*タグのイメージは最新10件だけを残します。
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
    },
    {
      "rulePriority": 2,
      "description": "Keep the 10 most recent main images",
      "selection": {
        "tagStatus": "tagged",
        "tagPatternList": ["main-*"],
        "countType": "imageCountMoreThan",
        "countNumber": 10
      },
      "action": {
        "type": "expire"
      }
    }
  ]
}
DEFAULT
}
