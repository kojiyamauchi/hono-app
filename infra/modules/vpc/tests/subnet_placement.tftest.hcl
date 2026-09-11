# モックで作成した状態を基準に、入力順や取得AZの変化で配置先が変わらないことを確認する。
mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = { names = ["ap-northeast-1a", "ap-northeast-1c"] }
  }
}

variables {
  service_name = "subnet-validation-test"
  env          = "dev"
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

run "baseline" {
  command = apply

  assert {
    condition = (
      { for cidr, subnet in aws_subnet.public_subnets : cidr => subnet.availability_zone } == {
        "10.0.0.0/24" = "ap-northeast-1a"
        "10.0.1.0/24" = "ap-northeast-1c"
      } &&
      { for cidr, subnet in aws_subnet.private_subnets : cidr => subnet.availability_zone } == {
        "10.0.2.0/24" = "ap-northeast-1a"
        "10.0.3.0/24" = "ap-northeast-1c"
      }
    )
    error_message = "CIDRとAZの対応は入力順や取得したAZ一覧の変化に影響されてはいけません。"
  }
}

run "reordered_subnets" {
  command = plan

  variables {
    subnets = {
      public = [
        { cidr_block = "10.0.1.0/24", availability_zone = "ap-northeast-1c" },
        { cidr_block = "10.0.0.0/24", availability_zone = "ap-northeast-1a" },
      ]
      private = [
        { cidr_block = "10.0.3.0/24", availability_zone = "ap-northeast-1c" },
        { cidr_block = "10.0.2.0/24", availability_zone = "ap-northeast-1a" },
      ]
    }
  }

  assert {
    condition = (
      { for cidr, subnet in aws_subnet.public_subnets : cidr => subnet.availability_zone } == {
        "10.0.0.0/24" = "ap-northeast-1a"
        "10.0.1.0/24" = "ap-northeast-1c"
      } &&
      { for cidr, subnet in aws_subnet.private_subnets : cidr => subnet.availability_zone } == {
        "10.0.2.0/24" = "ap-northeast-1a"
        "10.0.3.0/24" = "ap-northeast-1c"
      }
    )
    error_message = "CIDRとAZの対応は入力順や取得したAZ一覧の変化に影響されてはいけません。"
  }
}

run "reordered_available_zones" {
  command = plan

  override_data {
    target = data.aws_availability_zones.availability_zone
    values = { names = ["ap-northeast-1c", "ap-northeast-1a"] }
  }

  assert {
    condition = (
      { for cidr, subnet in aws_subnet.public_subnets : cidr => subnet.availability_zone } == {
        "10.0.0.0/24" = "ap-northeast-1a"
        "10.0.1.0/24" = "ap-northeast-1c"
      } &&
      { for cidr, subnet in aws_subnet.private_subnets : cidr => subnet.availability_zone } == {
        "10.0.2.0/24" = "ap-northeast-1a"
        "10.0.3.0/24" = "ap-northeast-1c"
      }
    )
    error_message = "CIDRとAZの対応は入力順や取得したAZ一覧の変化に影響されてはいけません。"
  }
}

run "added_available_zone" {
  command = plan

  override_data {
    target = data.aws_availability_zones.availability_zone
    values = { names = ["ap-northeast-1a", "ap-northeast-1c", "ap-northeast-1d"] }
  }

  assert {
    condition = (
      { for cidr, subnet in aws_subnet.public_subnets : cidr => subnet.availability_zone } == {
        "10.0.0.0/24" = "ap-northeast-1a"
        "10.0.1.0/24" = "ap-northeast-1c"
      } &&
      { for cidr, subnet in aws_subnet.private_subnets : cidr => subnet.availability_zone } == {
        "10.0.2.0/24" = "ap-northeast-1a"
        "10.0.3.0/24" = "ap-northeast-1c"
      }
    )
    error_message = "CIDRとAZの対応は入力順や取得したAZ一覧の変化に影響されてはいけません。"
  }
}

run "missing_selected_zone" {
  command = plan

  override_data {
    target = data.aws_availability_zones.availability_zone
    values = { names = ["ap-northeast-1c", "ap-northeast-1d"] }
  }

  expect_failures = [var.subnets]
}

run "single_zone_public" {
  command = plan

  variables {
    subnets = {
      public = [
        { cidr_block = "10.0.0.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.1.0/24", availability_zone = "ap-northeast-1a" },
      ]
      private = [
        { cidr_block = "10.0.2.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.3.0/24", availability_zone = "ap-northeast-1c" },
      ]
    }
  }

  expect_failures = [var.subnets]
}

run "single_zone_private" {
  command = plan

  variables {
    subnets = {
      public = [
        { cidr_block = "10.0.0.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.1.0/24", availability_zone = "ap-northeast-1c" },
      ]
      private = [
        { cidr_block = "10.0.2.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.3.0/24", availability_zone = "ap-northeast-1a" },
      ]
    }
  }

  expect_failures = [var.subnets]
}

run "null_zone" {
  command = plan

  variables {
    subnets = {
      public = [
        { cidr_block = "10.0.0.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.1.0/24", availability_zone = null },
      ]
      private = [
        { cidr_block = "10.0.2.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.3.0/24", availability_zone = "ap-northeast-1c" },
      ]
    }
  }

  expect_failures = [var.subnets]
}

run "empty_zone" {
  command = plan

  variables {
    subnets = {
      public = [
        { cidr_block = "10.0.0.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.1.0/24", availability_zone = "" },
      ]
      private = [
        { cidr_block = "10.0.2.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.3.0/24", availability_zone = "ap-northeast-1c" },
      ]
    }
  }

  expect_failures = [var.subnets]
}

run "whitespace_zone" {
  command = plan

  variables {
    subnets = {
      public = [
        { cidr_block = "10.0.0.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.1.0/24", availability_zone = " ap-northeast-1c" },
      ]
      private = [
        { cidr_block = "10.0.2.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.3.0/24", availability_zone = "ap-northeast-1c" },
      ]
    }
  }

  expect_failures = [var.subnets]
}

run "excluded_zone" {
  command = plan

  variables {
    subnets = {
      public = [
        { cidr_block = "10.0.0.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.1.0/24", availability_zone = "ap-northeast-1b" },
      ]
      private = [
        { cidr_block = "10.0.2.0/24", availability_zone = "ap-northeast-1a" },
        { cidr_block = "10.0.3.0/24", availability_zone = "ap-northeast-1c" },
      ]
    }
  }

  expect_failures = [var.subnets]
}
