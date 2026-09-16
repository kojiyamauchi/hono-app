locals {
  repository_tags = merge(
    var.repository_additional_tags,
    {
      ServiceName = var.service_name
      Env         = var.env
    }
  )
}

resource "aws_ecr_repository" "repository" {
  name                 = "${var.service_name}-${var.env}-${var.role}"
  image_tag_mutability = var.image_tag_mutability
  tags                 = local.repository_tags
}

resource "aws_ecr_lifecycle_policy" "policy" {
  repository = aws_ecr_repository.repository.name
  policy     = var.repository_lifecycle_policy == "" ? file("${path.module}/lifecycle_policy/default_policy.json") : var.repository_lifecycle_policy
}
