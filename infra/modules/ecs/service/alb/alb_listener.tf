resource "aws_alb_listener" "http_listener_forward" {
  count = (
    var.alb_enable_http_listener
  && !var.alb_enable_redirect_http_to_https) ? 1 : 0
  load_balancer_arn = aws_alb.alb.arn
  protocol          = "HTTP"
  port              = 80

  default_action {
    type             = "forward"
    target_group_arn = aws_alb_target_group.target_group.arn
  }

  tags = local.alb_tags
}

resource "aws_alb_listener" "http_listener_redirect" {
  count = (
    var.alb_enable_http_listener
  && var.alb_enable_redirect_http_to_https) ? 1 : 0
  load_balancer_arn = aws_alb.alb.arn
  protocol          = "HTTP"
  port              = 80

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }

  tags = local.alb_tags
}

resource "aws_alb_listener" "https_listener" {
  count             = var.alb_enable_https_listener ? 1 : 0
  load_balancer_arn = aws_alb.alb.arn
  protocol          = "HTTPS"
  port              = 443
  ssl_policy        = var.alb_https_listener_ssl_policy
  certificate_arn   = var.alb_https_certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_alb_target_group.target_group.arn
  }

  tags = local.alb_tags
}
