locals {
  service_name       = "hono-app"
  region             = "ap-northeast-1"
  web_container_name = "nginx"
  web_container_port = 80

  container_definitions = jsonencode([
    {
      name      = local.web_container_name
      image     = "public.ecr.aws/docker/library/nginx:1.30.6"
      cpu       = 1024
      memory    = 2048
      essential = true
      portMappings = [
        {
          containerPort = local.web_container_port
          hostPort      = local.web_container_port
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = module.log_group.log_group_name
          awslogs-region        = local.region
          awslogs-stream-prefix = local.service_name
        }
      }
    }
  ])
}
