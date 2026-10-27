output "alb_fqdn" {
  description = "ALBに付与されたFQDNです"
  value       = aws_lb.alb.dns_name
}

output "alb_zone_id" {
  description = <<-DESC
  ALBのホステッドゾーンIDです。
  Route53でエイリアスレコードで作成する際に利用します。
  DESC
  value       = aws_lb.alb.zone_id
}

output "alb_target_group_arn" {
  description = "ECSサービスに関連付けるターゲットグループのARN"
  value       = aws_lb_target_group.target_group.arn
}
