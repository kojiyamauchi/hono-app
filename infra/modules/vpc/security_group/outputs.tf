output "security_group_id" {
  description = "セキュリティグループのID"
  value       = aws_security_group.security_group.id
}
