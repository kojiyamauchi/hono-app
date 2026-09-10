resource "aws_vpc" "vpc" {
  cidr_block           = var.vpc_cidr_block
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = merge(
    var.vpc_additional_tags,
    {
      Name = "${var.service_name}-${var.env}-vpc"
      Env  = var.env
    }
  )
}
