subnets = {
  public = [
    { cidr_block = "10.0.0.0/24", availability_zone = "ap-northeast-1a" },
    { cidr_block = "10.0.1.0/24", availability_zone = "ap-northeast-1c" },
  ]
  private = [
    { cidr_block = "10.0.2.0/24", availability_zone = "ap-northeast-1a" },
    { cidr_block = "10.0.3.0/24", availability_zone = "ap-northeast-1c" },
  ]
}

excluded_availability_zones = ["ap-northeast-1b"]
