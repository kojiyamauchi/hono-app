# AWSリソースを作成せず、リスナー分岐とアクセスログの権限を確認する。
mock_provider "aws" {
  mock_resource "aws_alb" {
    defaults = {
      arn      = "arn:aws:elasticloadbalancing:ap-northeast-1:123456789012:loadbalancer/app/test/1234567890123456"
      dns_name = "test-alb.ap-northeast-1.elb.amazonaws.com"
      zone_id  = "Z1234567890"
    }
  }
  mock_resource "aws_alb_target_group" {
    defaults = { arn = "arn:aws:elasticloadbalancing:ap-northeast-1:123456789012:targetgroup/test/1234567890123456" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  mock_data "aws_route53_zone" {
    defaults = { id = "Z1234567890" }
  }
}

variables {
  service_name           = "hono-app"
  env                    = "dev"
  alb_vpc_id             = "vpc-12345678"
  alb_subnet_ids         = ["subnet-11111111", "subnet-22222222"]
  alb_security_group_ids = ["sg-12345678"]
}

run "http_without_domain" {
  command = apply

  assert {
    condition = (
      length(aws_alb_listener.http_listener_forward) == 1 &&
      length(aws_alb_listener.http_listener_redirect) == 0 &&
      length(aws_alb_listener.https_listener) == 0 &&
      length(aws_route53_record.name) == 0 &&
      length(data.aws_route53_zone.zone) == 0 &&
      one(aws_alb_listener.http_listener_forward[0].default_action).target_group_arn == output.alb_target_group_arn &&
      aws_alb_listener.http_listener_forward[0].load_balancer_arn == aws_alb.alb.arn
    )
    error_message = "証明書やドメインなしで、ALBのHTTPリスナーからターゲットグループへ転送する必要があります。"
  }

  assert {
    condition = (
      aws_alb_target_group.target_group.target_type == "ip" &&
      aws_alb_target_group.target_group.protocol == "HTTP" &&
      aws_alb_target_group.target_group.port == 80 &&
      one(aws_alb_target_group.target_group.health_check).port == "traffic-port" &&
      one(aws_alb_target_group.target_group.health_check).path == "/" &&
      one(aws_alb_target_group.target_group.health_check).healthy_threshold == 3 &&
      one(aws_alb_target_group.target_group.health_check).unhealthy_threshold == 3
    )
    error_message = "FargateのIPアドレスの80番ポートへ転送し、同じポートで正常性を確認する必要があります。"
  }

  assert {
    condition = (
      one(aws_s3_bucket_ownership_controls.log_bucket.rule).object_ownership == "BucketOwnerEnforced" &&
      aws_s3_bucket_public_access_block.log_bucket_public_access_block.block_public_policy &&
      one(one(aws_s3_bucket_server_side_encryption_configuration.log_bucket_sse_configuration.rule).apply_server_side_encryption_by_default).sse_algorithm == "AES256" &&
      one(one(data.aws_iam_policy_document.log_bucket_policy_document.statement).principals).identifiers == toset(["logdelivery.elasticloadbalancing.amazonaws.com"]) &&
      one(data.aws_iam_policy_document.log_bucket_policy_document.statement).resources == toset(["${aws_s3_bucket.log_bucket.arn}/AWSLogs/123456789012/*"]) &&
      one(data.aws_iam_policy_document.log_bucket_policy_document.statement).actions == toset(["s3:PutObject"])
    )
    error_message = "ログバケットはACLと公開アクセスを無効にし、当該アカウントのログ配信だけを許可する必要があります。"
  }
}

run "https_with_dns" {
  command = apply
  variables {
    alb_enable_https_listener         = true
    alb_enable_redirect_http_to_https = true
    alb_https_certificate_arn         = "arn:aws:acm:ap-northeast-1:123456789012:certificate/test"
    alb_domain_name                   = "dev.example.com"
    alb_hosted_zone_name              = "example.com"
  }
  assert {
    condition = (
      length(aws_alb_listener.http_listener_forward) == 0 &&
      one(one(aws_alb_listener.http_listener_redirect[0].default_action).redirect).protocol == "HTTPS" &&
      aws_alb_listener.https_listener[0].certificate_arn == var.alb_https_certificate_arn &&
      aws_alb_listener.https_listener[0].ssl_policy == "ELBSecurityPolicy-TLS13-1-2-2021-06" &&
      one(aws_route53_record.name[0].alias).name == aws_alb.alb.dns_name &&
      one(aws_route53_record.name[0].alias).zone_id == aws_alb.alb.zone_id &&
      aws_route53_record.name[0].zone_id == "Z1234567890"
    )
    error_message = "HTTPSを有効にした場合、HTTPをリダイレクトし、指定ゾーンのDNSをALBへ向ける必要があります。"
  }
}

run "production_protection" {
  command = plan
  variables { env = "prod" }
  assert {
    condition     = aws_alb.alb.enable_deletion_protection && !aws_s3_bucket.log_bucket.force_destroy
    error_message = "prodではALBの削除を保護し、ログ入りバケットの強制削除を無効にする必要があります。"
  }
}

run "one_subnet_is_rejected" {
  command = plan
  variables { alb_subnet_ids = ["subnet-11111111"] }
  expect_failures = [var.alb_subnet_ids]
}

run "https_requires_certificate" {
  command = plan
  variables { alb_enable_https_listener = true }
  expect_failures = [var.alb_https_certificate_arn]
}

run "redirect_requires_https" {
  command = plan
  variables { alb_enable_redirect_http_to_https = true }
  expect_failures = [var.alb_enable_redirect_http_to_https]
}

run "dns_requires_hosted_zone" {
  command = plan
  variables { alb_domain_name = "dev.example.com" }
  expect_failures = [var.alb_hosted_zone_name]
}

run "zero_healthy_threshold_is_rejected" {
  command = plan
  variables { alb_target_group_health_check_healthy_threshold = 0 }
  expect_failures = [var.alb_target_group_health_check_healthy_threshold]
}
