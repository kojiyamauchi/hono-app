output "vpc_id" {
  value       = module.vpc.vpc_id
  description = "VPCのID"
}

output "vpc_name" {
  value       = module.vpc.vpc_name
  description = "作成したVPCの名前"
}

output "ecs_cluster_name" {
  value       = module.ecs_cluster.cluster_name
  description = "作成したクラスターの名前"
}

output "ecs_cluster_arn" {
  value       = module.ecs_cluster.cluster_arn
  description = "作成したクラスターのARN"
}
