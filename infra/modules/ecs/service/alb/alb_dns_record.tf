resource "aws_route53_record" "alb_alias" {
  count   = var.alb_domain_name != null ? 1 : 0
  zone_id = data.aws_route53_zone.zone[0].id
  name    = var.alb_domain_name
  type    = "A"

  alias {
    name                   = aws_lb.alb.dns_name
    zone_id                = aws_lb.alb.zone_id
    evaluate_target_health = false
  }
}
