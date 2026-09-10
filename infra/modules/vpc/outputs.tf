output "vpc_id" {
  value       = aws_vpc.vpc.id
  description = "VPCのID"
}

output "vpc_name" {
  value       = aws_vpc.vpc.tags["Name"]
  description = "作成したVPCの名前"
}
