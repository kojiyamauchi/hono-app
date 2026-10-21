# AWSリソースを作成せず、許可元の指定に応じたルール生成と重複入力を検証する。
mock_provider "aws" {}

variables {
  service_name = "hono-app"
  env          = "dev"
  vpc_id       = "vpc-12345678"
}

run "no_sources_create_no_rules" {
  command = plan

  assert {
    condition = (
      length(aws_security_group_rule.ingress_cidr_security_group_rules) == 0 &&
      length(aws_security_group_rule.ingress_sg_security_group_rules) == 0 &&
      length(aws_security_group_rule.ingress_self_security_group_rules) == 0 &&
      length(aws_security_group_rule.security_group_rule_egress) == 0 &&
      length(aws_security_group_rule.security_group_rule_egress_sgs) == 0
    )
    error_message = "許可先や許可元が未指定なら通信ルールを作成しない必要があります。"
  }
}

run "cidrs_allow_configured_ports" {
  command = plan

  variables {
    security_group_ingress_ports = [80, 443]
    security_group_ingress_cidrs = ["10.0.0.0/24"]
    security_group_egress_cidrs  = ["10.0.1.0/24"]
  }

  assert {
    condition = (
      length(aws_security_group_rule.ingress_cidr_security_group_rules) == 2 &&
      aws_security_group_rule.ingress_cidr_security_group_rules["80"].from_port == 80 &&
      aws_security_group_rule.ingress_cidr_security_group_rules["443"].to_port == 443 &&
      aws_security_group_rule.ingress_cidr_security_group_rules["80"].cidr_blocks == tolist(["10.0.0.0/24"]) &&
      length(aws_security_group_rule.security_group_rule_egress) == 1 &&
      aws_security_group_rule.security_group_rule_egress[0].cidr_blocks == tolist(["10.0.1.0/24"])
    )
    error_message = "指定したCIDRとポートの組み合わせで通信を許可する必要があります。"
  }
}

run "security_group_only_rules" {
  command = plan

  variables {
    security_group_ingress_ports = [80, 443]
    security_group_ingress_sgs   = ["sg-12345678", "sg-87654321"]
    security_group_egress_sgs    = ["sg-87654321"]
  }

  assert {
    condition = (
      length(aws_security_group_rule.ingress_cidr_security_group_rules) == 0 &&
      length(aws_security_group_rule.security_group_rule_egress) == 0 &&
      length(aws_security_group_rule.ingress_sg_security_group_rules) == 4 &&
      aws_security_group_rule.ingress_sg_security_group_rules["80,sg-12345678"].from_port == 80 &&
      aws_security_group_rule.ingress_sg_security_group_rules["80,sg-12345678"].source_security_group_id == "sg-12345678" &&
      aws_security_group_rule.security_group_rule_egress_sgs["sg-87654321"].source_security_group_id == "sg-87654321"
    )
    error_message = "SGだけを指定してもCIDRルールを作らず、ポートとSGの組み合わせを許可する必要があります。"
  }
}

run "self_traffic_uses_configured_ports" {
  command = plan

  variables {
    security_group_ingress_ports      = [80, 443]
    security_group_ingress_allow_self = true
  }

  assert {
    condition = (
      length(aws_security_group_rule.ingress_self_security_group_rules) == 2 &&
      alltrue([for rule in aws_security_group_rule.ingress_self_security_group_rules : rule.self && rule.type == "ingress"]) &&
      aws_security_group_rule.ingress_self_security_group_rules["80"].from_port == 80 &&
      aws_security_group_rule.ingress_self_security_group_rules["80"].to_port == 80 &&
      aws_security_group_rule.ingress_self_security_group_rules["443"].from_port == 443 &&
      aws_security_group_rule.ingress_self_security_group_rules["443"].to_port == 443
    )
    error_message = "自己通信が有効なら指定したポートだけで同じSGからの通信を許可する必要があります。"
  }
}

run "empty_ports_without_sources_create_no_ingress_rules" {
  command = plan

  variables {
    security_group_ingress_ports = []
  }

  assert {
    condition = (
      length(aws_security_group_rule.ingress_cidr_security_group_rules) == 0 &&
      length(aws_security_group_rule.ingress_sg_security_group_rules) == 0 &&
      length(aws_security_group_rule.ingress_self_security_group_rules) == 0
    )
    error_message = "ポートと許可元が未指定ならingressルールを作成しない必要があります。"
  }
}

run "cidrs_require_ports" {
  command = plan

  variables {
    security_group_ingress_ports = []
    security_group_ingress_cidrs = ["10.0.0.0/24"]
  }

  expect_failures = [var.security_group_ingress_ports]
}

run "security_groups_require_ports" {
  command = plan

  variables {
    security_group_ingress_ports = []
    security_group_ingress_sgs   = ["sg-12345678"]
  }

  expect_failures = [var.security_group_ingress_ports]
}

run "self_traffic_requires_ports" {
  command = plan

  variables {
    security_group_ingress_ports      = []
    security_group_ingress_allow_self = true
  }

  expect_failures = [var.security_group_ingress_ports]
}

run "duplicate_inputs_create_unique_rules" {
  command = plan

  variables {
    security_group_ingress_ports      = [80, 443, 80]
    security_group_ingress_cidrs      = ["10.0.0.0/24"]
    security_group_ingress_sgs        = ["sg-12345678", "sg-87654321", "sg-12345678"]
    security_group_ingress_allow_self = true
    security_group_egress_sgs         = ["sg-87654321", "sg-87654321"]
  }

  assert {
    condition = (
      length(aws_security_group_rule.ingress_cidr_security_group_rules) == 2 &&
      length(aws_security_group_rule.ingress_sg_security_group_rules) == 4 &&
      length(aws_security_group_rule.ingress_self_security_group_rules) == 2 &&
      length(aws_security_group_rule.security_group_rule_egress_sgs) == 1
    )
    error_message = "ポートやSGが重複していても、一意な組み合わせだけでルールを作成する必要があります。"
  }
}
