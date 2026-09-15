# AWSへの通信やリソース作成を行わず、ECSクラスターの設定と入力検証を確認する。
mock_provider "aws" {}

variables {
  service_name = "ecs-cluster-test"
  env          = "dev"
}

run "cluster_configuration" {
  command = apply

  assert {
    condition     = aws_ecs_cluster.cluster.name == "ecs-cluster-test-dev-cluster"
    error_message = "ECSクラスター名はサービス名と環境を含む必要があります。"
  }

  assert {
    condition = (
      length(aws_ecs_cluster.cluster.setting) == 1 &&
      one(aws_ecs_cluster.cluster.setting).name == "containerInsights" &&
      one(aws_ecs_cluster.cluster.setting).value == "enabled"
    )
    error_message = "ECSクラスターでContainer Insightsを有効にする必要があります。"
  }

  assert {
    condition = (
      aws_ecs_cluster.cluster.tags["ServiceName"] == "ecs-cluster-test" &&
      aws_ecs_cluster.cluster.tags["Env"] == "dev"
    )
    error_message = "ECSクラスターはサービス名と環境の標準タグを持つ必要があります。"
  }

  assert {
    condition     = output.cluster_name == aws_ecs_cluster.cluster.name
    error_message = "クラスター名の出力は作成したECSクラスターと一致する必要があります。"
  }

  assert {
    condition     = output.cluster_arn == aws_ecs_cluster.cluster.arn
    error_message = "クラスターARNの出力は作成したECSクラスターと一致する必要があります。"
  }
}

run "fargate_capacity_provider" {
  command = plan

  assert {
    condition = (
      toset(aws_ecs_cluster_capacity_providers.cluster_capacity_provider.capacity_providers) == toset(["FARGATE"])
    )
    error_message = "ECSクラスターにはFARGATEのみを関連付ける必要があります。"
  }

  assert {
    condition = (
      length(aws_ecs_cluster_capacity_providers.cluster_capacity_provider.default_capacity_provider_strategy) == 1 &&
      one(aws_ecs_cluster_capacity_providers.cluster_capacity_provider.default_capacity_provider_strategy).capacity_provider == "FARGATE" &&
      one(aws_ecs_cluster_capacity_providers.cluster_capacity_provider.default_capacity_provider_strategy).weight == 1
    )
    error_message = "ECSクラスターのデフォルトcapacity providerはFARGATEである必要があります。"
  }
}

run "custom_tags" {
  command = plan

  variables {
    cluster_additional_tags = { Usage = "test" }
  }

  assert {
    condition     = aws_ecs_cluster.cluster.tags["Usage"] == "test"
    error_message = "ECSクラスターへ任意の追加タグを設定できる必要があります。"
  }
}

run "reserved_service_name" {
  command = plan

  variables {
    cluster_additional_tags = { ServiceName = "test" }
  }

  expect_failures = [var.cluster_additional_tags]
}

run "reserved_env" {
  command = plan

  variables {
    cluster_additional_tags = { Env = "test" }
  }

  expect_failures = [var.cluster_additional_tags]
}

run "invalid_env" {
  command = plan

  variables {
    env = "local"
  }

  expect_failures = [var.env]
}
