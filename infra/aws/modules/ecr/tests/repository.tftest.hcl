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
      aws_ecr_repository.repository.tags["ServiceName"] == "ecr-test" &&
      aws_ecr_repository.repository.tags["Env"] == "dev"
    )
    error_message = "ECRリポジトリはサービス名と環境の標準タグを持つ必要があります。"
  }

  assert {
    condition = (
      length(jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules) == 3 &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[0].rulePriority == 1 &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[0].selection.tagStatus == "untagged" &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[0].selection.countType == "sinceImagePushed" &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[0].selection.countUnit == "days" &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[0].selection.countNumber == 30 &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[0].action.type == "expire"
    )
    error_message = "デフォルトのポリシーはタグなしイメージをプッシュから30日後に削除する必要があります。"
  }

  assert {
    condition = (
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[1].rulePriority == 2 &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[1].selection.tagStatus == "tagged" &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[1].selection.tagPatternList == ["main-*"] &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[1].selection.countType == "imageCountMoreThan" &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[1].selection.countNumber == 10 &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[1].action.type == "expire"
    )
    error_message = "デフォルトのポリシーはmain-*タグのイメージを最新10件だけ残す必要があります。"
  }

  assert {
    condition = (
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[2].rulePriority == 3 &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[2].selection.tagStatus == "tagged" &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[2].selection.tagPatternList == ["manual-*"] &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[2].selection.countType == "sinceImagePushed" &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[2].selection.countUnit == "days" &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[2].selection.countNumber == 30 &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[2].action.type == "expire"
    )
    error_message = "デフォルトのポリシーは手動実行イメージを30日後に削除する必要があります。"
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
      length(jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules) == 3 &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[0].rulePriority == 1 &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[0].selection.tagStatus == "untagged" &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[0].selection.countType == "sinceImagePushed" &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[0].selection.countUnit == "days" &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[0].selection.countNumber == 30 &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[0].action.type == "expire"
    )
    error_message = "ファイルのポリシーはデフォルトと同じ条件でタグなしイメージを削除する必要があります。"
  }

  assert {
    condition = (
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[1].rulePriority == 2 &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[1].selection.tagStatus == "tagged" &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[1].selection.tagPatternList == ["main-*"] &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[1].selection.countType == "imageCountMoreThan" &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[1].selection.countNumber == 10 &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[1].action.type == "expire"
    )
    error_message = "ファイルのポリシーはmain-*タグのイメージを最新10件だけ残す必要があります。"
  }

  assert {
    condition = (
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[2].rulePriority == 3 &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[2].selection.tagPatternList == ["manual-*"] &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[2].selection.countType == "sinceImagePushed" &&
      jsondecode(aws_ecr_lifecycle_policy.policy.policy).rules[2].selection.countNumber == 30
    )
    error_message = "ファイルのポリシーは手動実行イメージを30日後に削除する必要があります。"
  }
}

run "invalid_image_tag_mutability" {
  command = plan

  variables {
    image_tag_mutability = "Mutable"
  }

  expect_failures = [var.image_tag_mutability]
}

run "custom_tags" {
  command = plan

  variables {
    repository_additional_tags = { Usage = "test" }
  }

  assert {
    condition     = aws_ecr_repository.repository.tags["Usage"] == "test"
    error_message = "ECRリポジトリへ任意の追加タグを設定できる必要があります。"
  }
}

run "reserved_service_name" {
  command = plan

  variables {
    repository_additional_tags = { ServiceName = "test" }
  }

  expect_failures = [var.repository_additional_tags]
}

run "reserved_env" {
  command = plan

  variables {
    repository_additional_tags = { Env = "test" }
  }

  expect_failures = [var.repository_additional_tags]
}

run "repository_outputs" {
  command = apply

  assert {
    condition     = output.repository_name == aws_ecr_repository.repository.name
    error_message = "リポジトリ名の出力は作成したリポジトリと一致する必要があります。"
  }

  assert {
    condition     = output.repository_arn == aws_ecr_repository.repository.arn
    error_message = "リポジトリARNの出力は作成したリポジトリと一致する必要があります。"
  }

  assert {
    condition     = output.repository_url == aws_ecr_repository.repository.repository_url
    error_message = "リポジトリURLの出力は作成したリポジトリと一致する必要があります。"
  }
}
