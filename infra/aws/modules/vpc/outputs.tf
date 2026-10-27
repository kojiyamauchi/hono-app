output "vpc_id" {
  value       = aws_vpc.vpc.id
  description = "VPCのID"
}

output "vpc_name" {
  value       = aws_vpc.vpc.tags["Name"]
  description = "作成したVPCの名前"
}

output "public_subnets" {
  value       = { for subnet in aws_subnet.public_subnets : subnet.availability_zone => subnet.id }
  description = "パブリックサブネットのアベイラビリティゾーンに紐づくサブネットID"
}

output "private_subnets" {
  value       = { for subnet in aws_subnet.private_subnets : subnet.availability_zone => subnet.id }
  description = "プライベートサブネットのアベイラビリティゾーンに紐づくサブネットID"
}

output "public_route_tables" {
  value       = { for availability_zone, route_table in aws_route_table.public_route_tables : availability_zone => route_table.id }
  description = "パブリックサブネットのアベイラビリティゾーンに紐づくルートテーブルID"
}

output "private_route_tables" {
  value       = { for availability_zone, route_table in aws_route_table.private_route_tables : availability_zone => route_table.id }
  description = "プライベートサブネットのアベイラビリティゾーンに紐づくルートテーブルID"
}
