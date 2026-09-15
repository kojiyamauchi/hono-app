output "cluster_name" {
  value       = aws_ecs_cluster.cluster.name
  description = "作成したクラスターの名前"
}

output "cluster_arn" {
  value       = aws_ecs_cluster.cluster.arn
  description = "作成したクラスターのARN"
}

