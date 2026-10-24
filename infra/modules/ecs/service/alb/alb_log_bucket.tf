resource "aws_s3_bucket" "log_bucket" {
  # 自動サフィックスで、アカウントや環境を跨ぐバケット名の衝突を避ける。
  bucket_prefix = "${substr(local.alb_name, 0, 24)}-logs-"
  force_destroy = local.alb_log_bucket_force_destroy
  tags          = local.alb_tags
}

resource "aws_s3_bucket_ownership_controls" "log_bucket" {
  bucket = aws_s3_bucket.log_bucket.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "log_bucket_public_access_block" {
  bucket = aws_s3_bucket.log_bucket.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "log_bucket_sse_configuration" {
  bucket = aws_s3_bucket.log_bucket.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "log_bucket_lifecycle" {
  bucket = aws_s3_bucket.log_bucket.id
  rule {
    id     = "access-logs"
    status = "Enabled"
    filter {}

    transition {
      storage_class = "STANDARD_IA"
      days          = var.alb_log_transition_in_days
    }

    expiration {
      days = var.alb_log_expiration_in_days
    }
  }
}

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "log_bucket_policy_document" {
  statement {
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["logdelivery.elasticloadbalancing.amazonaws.com"]
    }
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.log_bucket.arn}/AWSLogs/${data.aws_caller_identity.current.account_id}/*"]

    # ログ配信元を自アカウントのロードバランサーに限定する。
    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:elasticloadbalancing:*:${data.aws_caller_identity.current.account_id}:loadbalancer/*"]
    }
  }
}

resource "aws_s3_bucket_policy" "log_bucket_policy" {
  bucket = aws_s3_bucket.log_bucket.id
  policy = data.aws_iam_policy_document.log_bucket_policy_document.json
}
