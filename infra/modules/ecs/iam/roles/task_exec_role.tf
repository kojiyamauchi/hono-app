locals {
  task_exec_role_name = "${var.service_name}-${var.env}-task-exec-role"
  task_exec_role_tags = merge(var.task_exec_role_additional_tags, {
    Name        = local.task_exec_role_name
    ServiceName = var.service_name
    Env         = var.env
  })
}

resource "aws_iam_role" "task_exec_role" {
  name               = local.task_exec_role_name
  assume_role_policy = data.aws_iam_policy_document.assume_role_document.json
  tags               = local.task_exec_role_tags
}

data "aws_iam_policy_document" "task_exec_role_policy_document" {
  version = "2012-10-17"
  statement {
    sid = "ECRAuthorization"
    actions = [
      "ecr:GetAuthorizationToken"
    ]
    resources = ["*"]
  }

  statement {
    sid = "ECRPullImage"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage"
    ]
    resources = var.task_exec_role_ecr_repository_arns
  }

  statement {
    sid = "CloudWatchPutLog"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]
    resources = [for arn in var.task_exec_role_log_group_arns : "${arn}:*"]
  }

  dynamic "statement" {
    for_each = length(var.task_exec_role_ssm_parameter_arns) > 0 ? [1] : []
    content {
      sid       = "ReadApplicationParameters"
      actions   = ["ssm:GetParameters"]
      resources = var.task_exec_role_ssm_parameter_arns
    }
  }
}

resource "aws_iam_role_policy" "task_exec_role_policy" {
  name   = "${local.task_exec_role_name}-policy"
  role   = aws_iam_role.task_exec_role.id
  policy = data.aws_iam_policy_document.task_exec_role_policy_document.json
}
