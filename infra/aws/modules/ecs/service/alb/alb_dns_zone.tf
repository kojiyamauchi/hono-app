data "aws_route53_zone" "zone" {
  count        = var.alb_hosted_zone_name != null ? 1 : 0
  name         = var.alb_hosted_zone_name
  private_zone = false
}
