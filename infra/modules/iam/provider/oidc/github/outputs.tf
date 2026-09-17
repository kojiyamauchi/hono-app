output "iam_role_arn" {
  value       = aws_iam_role.role.arn
  description = "作成したIAMロールのARN"
}
