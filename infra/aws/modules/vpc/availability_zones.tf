data "aws_availability_zones" "availability_zone" {
  state = "available"

  exclude_names = var.excluded_availability_zones

  lifecycle {
    postcondition {
      condition     = length(self.names) >= 2
      error_message = "除外対象を除いた利用可能なAZが2つ以上必要です。配置先を自動変更せず処理を停止します。"
    }
  }
}
