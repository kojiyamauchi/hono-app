data "aws_ecr_repository" "web" {
  name = "${var.service_name}-${var.env}-web"
}

data "aws_iam_policy_document" "ecr_web_push" {
  statement {
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = [data.aws_ecr_repository.web.arn]
  }
}

resource "aws_iam_role_policy" "ecr_web_push" {
  name   = "${var.service_name}-${var.env}-ecr-web-push"
  role   = aws_iam_role.role.id
  policy = data.aws_iam_policy_document.ecr_web_push.json
}
