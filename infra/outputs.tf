output "vpc_id" {
  value       = module.vpc.vpc_id
  description = "VPCのID"
}

output "vpc_name" {
  value       = module.vpc.vpc_name
  description = "作成したVPCの名前"
}
