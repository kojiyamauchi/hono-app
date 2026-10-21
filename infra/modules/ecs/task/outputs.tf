output "task_definition_arn" {
  description = "作成したECSタスク定義のARN"
  value       = aws_ecs_task_definition.task_definition.arn
}

output "task_family_name" {
  description = "作成したECSタスク定義のfamily名"
  value       = aws_ecs_task_definition.task_definition.family
}
