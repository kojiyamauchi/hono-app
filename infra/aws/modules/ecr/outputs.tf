output "repository_name" {
  value       = aws_ecr_repository.repository.name
  description = "作成したECRリポジトリの名前"
}

output "repository_arn" {
  value       = aws_ecr_repository.repository.arn
  description = "作成したECRリポジトリのARN"
}

output "repository_url" {
  value       = aws_ecr_repository.repository.repository_url
  description = "イメージのプッシュ先となるECRリポジトリのURL"
}
