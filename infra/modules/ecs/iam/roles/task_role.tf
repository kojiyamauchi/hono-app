locals {
  task_role_name = "${var.service_name}-${var.env}-task-role"
  task_role_tags = merge(var.task_role_additional_tags, {
    Name        = local.task_role_name
    ServiceName = var.service_name
    Env         = var.env
  })
}

resource "aws_iam_role" "task_role" {
  name               = local.task_role_name
  assume_role_policy = data.aws_iam_policy_document.assume_role_document.json
  tags               = local.task_role_tags
}

resource "aws_iam_role_policy_attachment" "task_role_policy_attachment" {
  for_each   = toset(var.task_role_managed_policy_arns)
  role       = aws_iam_role.task_role.name
  policy_arn = each.key
}

resource "aws_iam_role_policy" "task_role_inline_policies" {
  for_each = var.task_role_inline_policies
  name     = each.key
  role     = aws_iam_role.task_role.name
  policy   = each.value
}
