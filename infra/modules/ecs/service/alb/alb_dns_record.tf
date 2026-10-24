resource "aws_route53_record" "name" {
  count   = var.alb_domain_name != null ? 1 : 0
  zone_id = data.aws_route53_zone.zone[0].id
  name    = var.alb_domain_name
  type    = "A"

  alias {
    name                   = aws_alb.alb.dns_name
    zone_id                = aws_alb.alb.zone_id
    evaluate_target_health = false
  }
}
