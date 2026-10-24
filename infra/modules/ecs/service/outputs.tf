output "service_name" {
  description = "作成したECSサービスの名前"
  value       = aws_ecs_service.service.name
}
