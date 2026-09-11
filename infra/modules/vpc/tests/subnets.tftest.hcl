# AWSへの通信やリソース作成を行わず、入力値の境界とCIDRの包含・重複を検証する。
# CIDRの異常系でも件数条件を満たし、件数エラーだけでテストが通ることを防ぐ。
mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = {
      names = ["ap-northeast-1a", "ap-northeast-1c"]
    }
  }
}

variables {
  service_name = "subnet-validation-test"
  env          = "dev"
}

run "valid_two_each" {
  command = plan

  variables {
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
  }

}

run "valid_three_each" {
  command = plan

  variables {
    subnets = {
      public = [
        { cidr_block = "10.0.0.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.1.0/24", availability_zone = "ap-northeast-1c" },
        { cidr_block = "10.0.4.0/24", availability_zone = "ap-northeast-1a" },
      ]
      private = [
        { cidr_block = "10.0.2.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.3.0/24", availability_zone = "ap-northeast-1c" },
        { cidr_block = "10.0.5.0/24", availability_zone = "ap-northeast-1a" },
      ]
    }
  }
}

run "valid_fill_vpc" {
  command = plan

  variables {
    subnets = {
      public = [
        { cidr_block = "10.0.0.0/18", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.64.0/18", availability_zone = "ap-northeast-1c" },
      ]
      private = [
        { cidr_block = "10.0.128.0/18", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.192.0/18", availability_zone = "ap-northeast-1c" },
      ]
    }
  }
}

run "valid_prefix_28_at_vpc_end" {
  command = plan

  variables {
    subnets = {
      public = [
        { cidr_block = "10.0.255.224/28", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.255.240/28", availability_zone = "ap-northeast-1c" },
      ]
      private = [
        { cidr_block = "10.0.2.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.3.0/24", availability_zone = "ap-northeast-1c" },
      ]
    }
  }
}

run "valid_adjacent_different_sizes" {
  command = plan

  variables {
    subnets = {
      public = [
        { cidr_block = "10.0.0.0/25", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.0.128/26", availability_zone = "ap-northeast-1c" },
      ]
      private = [
        { cidr_block = "10.0.0.192/27", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.0.224/27", availability_zone = "ap-northeast-1c" },
      ]
    }
  }
}

run "invalid_empty_lists" {
  command = plan

  variables {
    subnets = {
      public  = []
      private = []
    }
  }

  expect_failures = [var.subnets]
}

run "invalid_one_each" {
  command = plan

  variables {
    subnets = {
      public = [
        { cidr_block = "10.0.0.0/24", availability_zone = "ap-northeast-1a" },
      ]
      private = [
        { cidr_block = "10.0.2.0/24", availability_zone = "ap-northeast-1a" },
      ]
    }
  }

  expect_failures = [var.subnets]
}

run "invalid_public_count" {
  command = plan

  variables {
    subnets = {
      public = [
        { cidr_block = "10.0.0.0/24", availability_zone = "ap-northeast-1a" },
      ]
      private = [
        { cidr_block = "10.0.2.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.3.0/24", availability_zone = "ap-northeast-1c" },
      ]
    }
  }

  expect_failures = [var.subnets]
}

run "invalid_private_count" {
  command = plan

  variables {
    subnets = {
      public = [
        { cidr_block = "10.0.0.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.1.0/24", availability_zone = "ap-northeast-1c" },
      ]
      private = [
        { cidr_block = "10.0.2.0/24", availability_zone = "ap-northeast-1a" },
      ]
    }
  }

  expect_failures = [var.subnets]
}

run "invalid_different_counts" {
  command = plan

  variables {
    subnets = {
      public = [
        { cidr_block = "10.0.0.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.1.0/24", availability_zone = "ap-northeast-1c" },
      ]
      private = [
        { cidr_block = "10.0.2.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.3.0/24", availability_zone = "ap-northeast-1c" },
        { cidr_block = "10.0.4.0/24", availability_zone = "ap-northeast-1a" },
      ]
    }
  }

  expect_failures = [var.subnets]
}

run "invalid_ipv4" {
  command = plan

  variables {
    subnets = {
      public = [
        { cidr_block = "999.0.0.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.1.0/24", availability_zone = "ap-northeast-1c" },
      ]
      private = [
        { cidr_block = "10.0.2.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.3.0/24", availability_zone = "ap-northeast-1c" },
      ]
    }
  }

  expect_failures = [var.subnets]
}

run "invalid_ipv6" {
  command = plan

  variables {
    subnets = {
      public = [
        { cidr_block = "10.0.0.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.1.0/24", availability_zone = "ap-northeast-1c" },
      ]
      private = [
        { cidr_block = "2001:db8::/64", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.3.0/24", availability_zone = "ap-northeast-1c" },
      ]
    }
  }

  expect_failures = [var.subnets]
}

run "invalid_host_address" {
  command = plan

  variables {
    subnets = {
      public = [
        { cidr_block = "10.0.0.1/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.1.0/24", availability_zone = "ap-northeast-1c" },
      ]
      private = [
        { cidr_block = "10.0.2.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.3.0/24", availability_zone = "ap-northeast-1c" },
      ]
    }
  }

  expect_failures = [var.subnets]
}

run "invalid_prefix_15" {
  command = plan

  variables {
    subnets = {
      public = [
        { cidr_block = "10.0.0.0/15", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.1.0/24", availability_zone = "ap-northeast-1c" },
      ]
      private = [
        { cidr_block = "10.0.2.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.3.0/24", availability_zone = "ap-northeast-1c" },
      ]
    }
  }

  expect_failures = [var.subnets]
}

run "invalid_prefix_29" {
  command = plan

  variables {
    subnets = {
      public = [
        { cidr_block = "10.0.0.0/29", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.1.0/24", availability_zone = "ap-northeast-1c" },
      ]
      private = [
        { cidr_block = "10.0.2.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.3.0/24", availability_zone = "ap-northeast-1c" },
      ]
    }
  }

  expect_failures = [var.subnets]
}

run "invalid_missing_prefix" {
  command = plan

  variables {
    subnets = {
      public = [
        { cidr_block = "10.0.0.0", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.1.0/24", availability_zone = "ap-northeast-1c" },
      ]
      private = [
        { cidr_block = "10.0.2.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.3.0/24", availability_zone = "ap-northeast-1c" },
      ]
    }
  }

  expect_failures = [var.subnets]
}

run "invalid_null_public_list" {
  command = plan

  variables {
    subnets = {
      public = null
      private = [
        { cidr_block = "10.0.2.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.3.0/24", availability_zone = "ap-northeast-1c" },
      ]
    }
  }

  expect_failures = [var.subnets]
}

run "invalid_null_private_list" {
  command = plan

  variables {
    subnets = {
      public = [
        { cidr_block = "10.0.0.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.1.0/24", availability_zone = "ap-northeast-1c" },
      ]
      private = null
    }
  }

  expect_failures = [var.subnets]
}

run "invalid_null_element" {
  command = plan

  variables {
    subnets = {
      public = [
        { cidr_block = "10.0.0.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.1.0/24", availability_zone = "ap-northeast-1c" },
      ]
      private = [
        null,
        { cidr_block = "10.0.3.0/24", availability_zone = "ap-northeast-1c" },
      ]
    }
  }

  expect_failures = [var.subnets]
}

run "invalid_outside_vpc" {
  command = plan

  variables {
    subnets = {
      public = [
        { cidr_block = "10.0.0.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.1.0/24", availability_zone = "ap-northeast-1c" },
      ]
      private = [
        { cidr_block = "10.1.0.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.3.0/24", availability_zone = "ap-northeast-1c" },
      ]
    }
  }

  expect_failures = [var.subnets]
}

run "invalid_larger_than_vpc" {
  command = plan

  variables {
    vpc_cidr_block = "10.0.0.0/24"
    subnets = {
      public = [
        { cidr_block = "10.0.0.0/23", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.0.128/27", availability_zone = "ap-northeast-1c" },
      ]
      private = [
        { cidr_block = "10.0.0.160/27", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.0.192/27", availability_zone = "ap-northeast-1c" },
      ]
    }
  }

  expect_failures = [var.subnets]
}

run "invalid_duplicate_within_public" {
  command = plan

  variables {
    subnets = {
      public = [
        { cidr_block = "10.0.0.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.0.0/24", availability_zone = "ap-northeast-1c" },
      ]
      private = [
        { cidr_block = "10.0.2.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.3.0/24", availability_zone = "ap-northeast-1c" },
      ]
    }
  }

  expect_failures = [var.subnets]
}

run "invalid_duplicate_across_types" {
  command = plan

  variables {
    subnets = {
      public = [
        { cidr_block = "10.0.0.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.1.0/24", availability_zone = "ap-northeast-1c" },
      ]
      private = [
        { cidr_block = "10.0.0.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.3.0/24", availability_zone = "ap-northeast-1c" },
      ]
    }
  }

  expect_failures = [var.subnets]
}

run "invalid_overlap_across_types" {
  command = plan

  variables {
    subnets = {
      public = [
        { cidr_block = "10.0.0.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.1.0/24", availability_zone = "ap-northeast-1c" },
      ]
      private = [
        { cidr_block = "10.0.0.128/25", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.3.0/24", availability_zone = "ap-northeast-1c" },
      ]
    }
  }

  expect_failures = [var.subnets]
}

run "invalid_overlap_reverse_order" {
  command = plan

  variables {
    subnets = {
      public = [
        { cidr_block = "10.0.0.128/25", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.1.0/24", availability_zone = "ap-northeast-1c" },
      ]
      private = [
        { cidr_block = "10.0.0.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.3.0/24", availability_zone = "ap-northeast-1c" },
      ]
    }
  }

  expect_failures = [var.subnets]
}

run "invalid_overlap_within_private" {
  command = plan

  variables {
    subnets = {
      public = [
        { cidr_block = "10.0.0.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.1.0/24", availability_zone = "ap-northeast-1c" },
      ]
      private = [
        { cidr_block = "10.0.2.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.2.128/25", availability_zone = "ap-northeast-1c" },
      ]
    }
  }

  expect_failures = [var.subnets]
}
