variable "subnets" {
  description = "VPC内に作成するpublic/privateサブネットのCIDRと配置先AZ"
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
