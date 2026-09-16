# AWSへの通信やリソース作成を行わず、ECRリポジトリとライフサイクルポリシーを確認する。
mock_provider "aws" {}

variables {
  service_name = "ecr-test"
  env          = "dev"
  role         = "api"
}

run "default_repository" {
  command = plan

  assert {
    condition = (
      aws_ecr_repository.repository.name == "ecr-test-dev-api" &&
      aws_ecr_repository.repository.image_tag_mutability == "MUTABLE"
    )
    error_message = "リポジトリ名にはサービス名・環境・ロールを含め、タグはデフォルトで上書き可能にする必要があります。"
  }

  assert {
    condition     = aws_ecr_lifecycle_policy.policy.repository == aws_ecr_repository.repository.name
    error_message = "ライフサイクルポリシーは作成したリポジトリへ適用する必要があります。"
  }

  assert {
    condition = (
      length(jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules) == 1 &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[0].rulePriority == 1 &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[0].selection.tagStatus == "untagged" &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[0].selection.countType == "sinceImagePushed" &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[0].selection.countUnit == "days" &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[0].selection.countNumber == 30 &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[0].action.type == "expire"
    )
    error_message = "デフォルトのポリシーはタグなしイメージをプッシュから30日後に削除する必要があります。"
  }
}

run "custom_repository_settings" {
  command = plan

  variables {
    image_tag_mutability = "IMMUTABLE"
    repository_lifecycle_policy = jsonencode({
      rules = [{
        rulePriority = 1
        description  = "Expire untagged images older than 7 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 7
        }
        action = { type = "expire" }
      }]
    })
  }

  assert {
    condition     = aws_ecr_repository.repository.image_tag_mutability == "IMMUTABLE"
    error_message = "指定したタグ変更可否がリポジトリへ反映される必要があります。"
  }

  assert {
    condition     = jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[0].selection.countNumber == 7
    error_message = "指定したライフサイクルポリシーが反映される必要があります。"
  }
}

run "invalid_env" {
  command = plan

  variables {
    env = "local"
  }

  expect_failures = [var.env]
}

run "file_lifecycle_policy" {
  command = plan

  variables {
    repository_lifecycle_policy = ""
  }

  assert {
    condition = (
      length(jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules) == 1 &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[0].rulePriority == 1 &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[0].selection.tagStatus == "untagged" &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[0].selection.countType == "sinceImagePushed" &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[0].selection.countUnit == "days" &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[0].selection.countNumber == 30 &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[0].action.type == "expire"
    )
    error_message = "ファイルのポリシーはデフォルトと同じ条件でタグなしイメージを削除する必要があります。"
  }
}

run "invalid_image_tag_mutability" {
  command = plan

  variables {
    image_tag_mutability = "Mutable"
  }

  expect_failures = [var.image_tag_mutability]
}
