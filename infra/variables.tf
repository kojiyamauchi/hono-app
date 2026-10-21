variable "subnets" {
  description = "VPC内の同じAZ集合へ1つのAZにつき各1つ作成するpublic/privateサブネットのCIDRと配置先AZ"
  nullable    = false
  type = object({
    public = list(object({
      cidr_block        = string
      availability_zone = string
    }))
    private = list(object({
      cidr_block        = string
      availability_zone = string
    }))
  })
}

variable "excluded_availability_zones" {
  type        = list(string)
  default     = []
  nullable    = false
  description = "サブネットの配置先から除外するAZ名"
}

locals {
  container_definitions = jsonencode([
    {
      name      = "nginx"
      image     = "public.ecr.aws/nginx/nginx:1.21"
      cpu       = 1024
      memory    = 2048
      essential = true
      portMappings = [
        {
          containerPort = 80
          hostPort      = 80
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = module.log_group.log_group_name
          awslogs-region        = "ap-northeast-1"
          awslogs-stream-prefix = local.service_name
        }
      }
    }
  ])
}
