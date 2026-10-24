resource "aws_lb" "alb" {
  name                       = local.alb_name
  internal                   = false
  enable_deletion_protection = var.env == "prod"
  drop_invalid_header_fields = true

  load_balancer_type = "application"

  subnets = var.alb_subnet_ids

  security_groups = var.alb_security_group_ids

  access_logs {
    bucket  = aws_s3_bucket.log_bucket.bucket
    enabled = true
  }

  # ログ配信権限の設定が終わってから、アクセスログを有効にする。
  depends_on = [
    aws_s3_bucket_policy.log_bucket_policy,
    aws_s3_bucket_ownership_controls.log_bucket,
    aws_s3_bucket_server_side_encryption_configuration.log_bucket_sse_configuration,
  ]

  lifecycle {
    precondition {
      condition     = length(local.alb_name) <= 32 && can(regex("^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]$", local.alb_name)) && !startswith(local.alb_name, "internal-")
      error_message = "ALB名は英数字とハイフンの32文字以内とし、internal-で始めないでください。"
    }
  }

  tags = local.alb_tags
}
