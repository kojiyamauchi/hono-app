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

output "github_ecr_push_role_arn" {
  value       = module.github_ecr_push.iam_role_arn
  description = "GitHub ActionsがECRへイメージを登録するIAMロールのARN"
}

output "alb_url" {
  description = "動作確認用の公開URL"
  value       = "${var.alb_https_certificate_arn != null ? "https" : "http"}://${coalesce(var.alb_domain_name, module.alb.alb_fqdn)}"
}

output "ecs_service_name" {
  description = "タスクを維持するECSサービスの名前"
  value       = module.ecs_service.service_name
}

output "ecr_repository_url" {
  description = "Honoイメージを登録するECRリポジトリのURL"
  value       = module.ecr_web.repository_url
}

output "application_image" {
  description = "タスクが起動するダイジェスト付きHonoイメージ"
  value       = local.application_image
}
