import { isDeepStrictEqual } from 'node:util'

/** ログへ出せる固定文だけを保持する配備エラー。 */
export class DeploymentError extends Error {}

// provider 7.46系が更新時に再計算する出力属性だけを除外する。設定属性は除外しない。
const computedFields = [
  'conditions',
  'create_time',
  'creator',
  'delete_time',
  'effective_annotations',
  'effective_labels',
  'etag',
  'expire_time',
  'generation',
  'last_modifier',
  'latest_created_revision',
  'latest_ready_revision',
  'observed_generation',
  'reconciling',
  'terminal_condition',
  'terraform_labels',
  'traffic_statuses',
  'uid',
  'update_time',
  'uri',
  'urls',
]

/** Terraform planが、対象サービスの既知のイメージ更新だけであることを検証する。 */
export function assertDeploymentPlan(plan, expectedImage, noChanges = false) {
  if (!/^1\./.test(plan.format_version ?? '') || plan.errored || plan.complete !== true || plan.deferred_changes?.length) {
    throw new DeploymentError('不完全または未対応のplanです。')
  }
  if (plan.resource_drift?.some(({ change }) => !isDeepStrictEqual(change.actions, ['no-op']))) {
    throw new DeploymentError('実環境のdriftを検出しました。個別確認が必要です。')
  }
  const changes = plan.resource_changes
  if (!Array.isArray(changes)) throw new DeploymentError('リソースの検査情報がありません。')
  const app = changes.find(({ address }) => address === 'google_cloud_run_v2_service.app[0]')
  if (!app || app.mode !== 'managed' || app.type !== 'google_cloud_run_v2_service') throw new DeploymentError('配備対象サービスがありません。')
  for (const { address, change } of changes) {
    if (isDeepStrictEqual(change.actions, ['no-op'])) continue
    if (noChanges || address !== app.address || !isDeepStrictEqual(change.actions, ['update'])) {
      throw new DeploymentError('通常配備の範囲外のリソース変更です。')
    }
  }
  const { before, after, after_unknown: unknown = {} } = app.change
  if (after?.name !== 'hono-app-dev' || after?.project !== 'hono-app-dev-512908-f3' || after?.location !== 'asia-northeast1') {
    throw new DeploymentError('配備対象のproject・region・サービス名が一致しません。')
  }
  if (!before || !after || !after.iap_enabled || after.invoker_iam_disabled !== false || after.deletion_protection !== true) {
    throw new DeploymentError('IAP・IAM・削除保護を維持できません。')
  }
  if (after.template?.length !== 1 || after.template[0].containers?.length !== 1 || after.template[0].containers[0].image !== expectedImage) {
    throw new DeploymentError('配備予定のイメージが確定digestと一致しません。')
  }
  const allowedUnknown = structuredClone(unknown)
  for (const key of computedFields) delete allowedUnknown[key]
  if (hasUnknown(allowedUnknown)) throw new DeploymentError('設定属性に未確定値があります。')
  const normalized = [before, after].map((value) => {
    const result = structuredClone(value)
    for (const key of computedFields) delete result[key]
    delete result.template[0].containers[0].image
    return result
  })
  if (!isDeepStrictEqual(...normalized)) throw new DeploymentError('イメージ以外の設定変更は自動適用できません。')
  for (const [name, change] of Object.entries(plan.output_changes ?? {})) {
    if (isDeepStrictEqual(change.actions, ['no-op'])) continue
    if (!noChanges && name === 'service_url' && change.after_unknown === true && isDeepStrictEqual(change.actions, ['update'])) continue
    throw new DeploymentError('想定外のoutput変更があります。')
  }
}

/** unknownの空配列・falseと、実際の未確定値を区別する。 */
function hasUnknown(value) {
  if (value === true) return true
  return value && typeof value === 'object' ? Object.values(value).some(hasUnknown) : false
}

/** DB履歴がローカルmigrationの適用済み接頭辞であることを確認し、未適用名を返す。 */
export function pendingMigrations(migrations, history) {
  const applied = history.filter((row) => !row.rolled_back_at)
  if (applied.some((row) => !row.finished_at)) throw new DeploymentError('失敗済みまたは実行中のmigrationがあります。')
  const names = applied.map((row) => row.migration_name).sort()
  if (
    new Set(names).size !== names.length ||
    !isDeepStrictEqual(
      names,
      migrations.slice(0, names.length).map(({ name }) => name),
    )
  ) {
    throw new DeploymentError('migration履歴が一致しません。')
  }
  for (const row of applied) {
    if (migrations.find(({ name }) => name === row.migration_name)?.checksum !== row.checksum) {
      throw new DeploymentError('適用済みmigrationのチェックサムが一致しません。')
    }
  }
  return migrations.slice(names.length).map(({ name }) => name)
}

/** 現行と直前digestの保護タグを維持し、不要なreleaseタグだけを選ぶ。 */
export function obsoleteReleaseTags(tags, current, previous) {
  if (!/^sha256:[a-f0-9]{64}$/.test(current) || !/^sha256:[a-f0-9]{64}$/.test(previous)) throw new DeploymentError('保持対象digestが不正です。')
  const keep = new Set([current, previous])
  return tags.filter(({ tag, version }) => {
    if (!/^release-(?:[a-f0-9]{64}|[a-f0-9]{40}|[a-f0-9]{8})$/.test(tag?.split('/').at(-1) ?? '')) return false
    const digest = version?.split('/').at(-1)
    if (!/^sha256:[a-f0-9]{64}$/.test(digest ?? '')) throw new DeploymentError('保護タグのdigestを確認できません。')
    return !keep.has(digest)
  })
}

/** 固定Secretから渡されたURLのTLS検証と接続方式を確認する。 */
export function assertDatabaseUrl(value) {
  const url = new URL(value)
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.searchParams.get('sslmode') !== 'verify-full' ||
    url.searchParams.size !== 1 ||
    url.port !== '5432' ||
    /[\r\n]/.test(value)
  ) {
    throw new DeploymentError('DB接続は5432番・verify-fullを使用してください。')
  }
}
