# JSON生成はモックし、ロールへの関連付けと実際のポリシーstatement入力を検証する。
mock_provider "aws" {
  mock_data "aws_iam_policy_document" {
    defaults = {
      json = jsonencode({ Version = "2012-10-17", Statement = [] })
    }
  }
}

variables {
  service_name                       = "hono-app"
  env                                = "dev"
  task_exec_role_ecr_repository_arns = ["arn:aws:ecr:ap-northeast-1:123456789012:repository/hono-app-dev-web"]
  task_exec_role_log_group_arns      = ["arn:aws:logs:ap-northeast-1:123456789012:log-group:hono-app-dev-log-group"]
}

run "ecs_trust_and_execution_permissions" {
  command = plan

  assert {
    condition = (
      data.aws_iam_policy_document.assume_role_document.version == "2012-10-17" &&
      one(data.aws_iam_policy_document.assume_role_document.statement).effect == "Allow" &&
      one(data.aws_iam_policy_document.assume_role_document.statement).actions == toset(["sts:AssumeRole"]) &&
      one(one(data.aws_iam_policy_document.assume_role_document.statement).principals).type == "Service" &&
      one(one(data.aws_iam_policy_document.assume_role_document.statement).principals).identifiers == toset(["ecs-tasks.amazonaws.com"])
    )
    error_message = "ECSタスクがロールを引き受けられる信頼ポリシーを定義する必要があります。"
  }

  assert {
    condition = (
      length(data.aws_iam_policy_document.task_exec_role_policy_document.statement) == 3 &&
      one([for statement in data.aws_iam_policy_document.task_exec_role_policy_document.statement : statement if statement.sid == "ECRAuthorization"]).actions == toset(["ecr:GetAuthorizationToken"]) &&
      one([for statement in data.aws_iam_policy_document.task_exec_role_policy_document.statement : statement if statement.sid == "ECRAuthorization"]).resources == toset(["*"]) &&
      one([for statement in data.aws_iam_policy_document.task_exec_role_policy_document.statement : statement if statement.sid == "ECRPullImage"]).actions == toset([
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
      ]) &&
      one([for statement in data.aws_iam_policy_document.task_exec_role_policy_document.statement : statement if statement.sid == "ECRPullImage"]).resources == toset(var.task_exec_role_ecr_repository_arns) &&
      one([for statement in data.aws_iam_policy_document.task_exec_role_policy_document.statement : statement if statement.sid == "CloudWatchPutLog"]).actions == toset([
        "logs:CreateLogStream",
        "logs:PutLogEvents",
      ]) &&
      one([for statement in data.aws_iam_policy_document.task_exec_role_policy_document.statement : statement if statement.sid == "CloudWatchPutLog"]).resources == toset(["${var.task_exec_role_log_group_arns[0]}:*"])
    )
    error_message = "認証トークン以外の実行権限は指定したECRリポジトリとロググループへ限定する必要があります。"
  }
}

run "role_names_tags_and_policy_bindings" {
  command = plan

  variables {
    task_role_managed_policy_arns = ["arn:aws:iam::123456789012:policy/read-logs"]
    task_role_inline_policies = {
      "describe-logs" = jsonencode({
        Version = "2012-10-17"
        Statement = [{
          Effect   = "Allow"
          Action   = "logs:DescribeLogGroups"
          Resource = "*"
        }]
      })
    }
  }

  assert {
    condition = (
      aws_iam_role.task_role.name == "hono-app-dev-task-role" &&
      aws_iam_role.task_exec_role.name == "hono-app-dev-task-exec-role" &&
      aws_iam_role.task_role.tags["Name"] == "hono-app-dev-task-role" &&
      aws_iam_role.task_exec_role.tags["Name"] == "hono-app-dev-task-exec-role" &&
      aws_iam_role.task_role.tags["Env"] == "dev" &&
      aws_iam_role.task_exec_role.tags["Env"] == "dev"
    )
    error_message = "タスク用の2ロールは用途別の名前と環境タグを持つ必要があります。"
  }

  assert {
    condition = (
      aws_iam_role_policy_attachment.task_role_policy_attachment["arn:aws:iam::123456789012:policy/read-logs"].role == "hono-app-dev-task-role" &&
      aws_iam_role_policy.task_role_inline_policies["describe-logs"].role == "hono-app-dev-task-role" &&
      aws_iam_role_policy.task_role_inline_policies["describe-logs"].policy == var.task_role_inline_policies["describe-logs"]
    )
    error_message = "管理ポリシーとインラインポリシーはARNではなくタスクロール名へ関連付ける必要があります。"
  }
}

run "ten_managed_policies_are_allowed" {
  command = plan

  variables {
    task_role_managed_policy_arns = [for index in range(10) : "arn:aws:iam::123456789012:policy/policy-${index}"]
  }

  assert {
    condition     = length(aws_iam_role_policy_attachment.task_role_policy_attachment) == 10
    error_message = "上限である10件の管理ポリシーを関連付けられる必要があります。"
  }
}

run "eleven_managed_policies_are_rejected" {
  command = plan

  variables {
    task_role_managed_policy_arns = [for index in range(11) : "arn:aws:iam::123456789012:policy/policy-${index}"]
  }

  expect_failures = [var.task_role_managed_policy_arns]
}

run "wildcard_repository_is_rejected" {
  command = plan

  variables {
    task_exec_role_ecr_repository_arns = ["*"]
  }

  expect_failures = [var.task_exec_role_ecr_repository_arns]
}

run "wildcard_log_group_is_rejected" {
  command = plan

  variables {
    task_exec_role_log_group_arns = ["*"]
  }

  expect_failures = [var.task_exec_role_log_group_arns]
}
