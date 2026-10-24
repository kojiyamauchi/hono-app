resource "aws_lb_target_group" "target_group" {
  name = local.alb_target_group_name

  port        = var.alb_target_group_port
  protocol    = "HTTP"
  vpc_id      = var.alb_vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    port                = var.alb_target_group_health_check_port == 0 ? "traffic-port" : tostring(var.alb_target_group_health_check_port)
    path                = var.alb_target_group_health_check_path
    interval            = var.alb_target_group_health_check_interval
    healthy_threshold   = var.alb_target_group_health_check_healthy_threshold
    unhealthy_threshold = var.alb_target_group_health_check_unhealthy_threshold

    # ステータスコードが200番台であればHealthyと判断する
    matcher = "200-299"
  }

  tags = local.alb_tags
}
