import { describe, expect, test } from 'bun:test'

import { assertDatabaseUrl, assertDeploymentPlan, obsoleteReleaseTags, pendingMigrations } from './gcp-cd-policy.mjs'

import { imagePath, imagePlan, newDigest, oldDigest } from './gcp-cd-fixtures.js'

describe('配備planの許可範囲', () => {
  test('確定digestだけの変更とproviderの計算属性を許可する', () => {
    expect(() => assertDeploymentPlan(imagePlan(), `${imagePath}@${newDigest}`)).not.toThrow()
  })
  test.each([
    [
      'IAP解除',
      (p) => {
        p.resource_changes[0].change.after.iap_enabled = false
      },
    ],
    [
      'IAM検査解除',
      (p) => {
        p.resource_changes[0].change.after.invoker_iam_disabled = true
      },
    ],
    [
      '環境変数変更',
      (p) => {
        p.resource_changes[0].change.after.template[0].containers[0].env.push({ name: 'JWT_SECRET', value: 'unsafe' })
      },
    ],
    [
      'Secret参照変更',
      (p) => {
        p.resource_changes[0].change.after.template[0].containers[0].env.push({ name: 'DATABASE_URL', value_source: [{ secret_key_ref: [{ version: '3' }] }] })
      },
    ],
    [
      'スケール変更',
      (p) => {
        p.resource_changes[0].change.after.scaling = [{ max_instance_count: 2 }]
      },
    ],
    [
      'revision名の指定',
      (p) => {
        p.resource_changes[0].change.after.template[0].revision = 'custom-revision'
      },
    ],
    [
      '未確定revision入力',
      (p) => {
        p.resource_changes[0].change.after_unknown.template[0].revision = true
      },
    ],
    [
      '権限変更',
      (p) => {
        p.resource_changes.push({ address: 'google_project_iam_member.other', change: { actions: ['update'] } })
      },
    ],
    [
      '新規作成',
      (p) => {
        p.resource_changes[0].change.actions = ['create']
      },
    ],
    [
      '置換',
      (p) => {
        p.resource_changes[0].change.actions = ['delete', 'create']
      },
    ],
    [
      '新しい出力',
      (p) => {
        p.output_changes.other = { actions: ['create'] }
      },
    ],
    [
      'drift',
      (p) => {
        p.resource_drift = [{ change: { actions: ['update'] } }]
      },
    ],
    [
      '未確定設定',
      (p) => {
        p.resource_changes[0].change.after_unknown.template[0].service_account = true
      },
    ],
    [
      '別digest',
      (p) => {
        p.resource_changes[0].change.after.template[0].containers[0].image = `${imagePath}@${oldDigest}`
      },
    ],
    [
      '不完全plan',
      (p) => {
        p.complete = false
      },
    ],
    [
      '未知形式',
      (p) => {
        p.format_version = '2.0'
      },
    ],
    [
      '遅延した変更',
      (p) => {
        p.deferred_changes = [{}]
      },
    ],
    [
      '対象欠落',
      (p) => {
        p.resource_changes = []
      },
    ],
  ])('%sを拒否する', (_name, mutate) => {
    const plan = imagePlan()
    mutate(plan)
    expect(() => assertDeploymentPlan(plan, `${imagePath}@${newDigest}`)).toThrow()
  })
  test('配備後にはイメージ更新も残っていてはいけない', () => {
    expect(() => assertDeploymentPlan(imagePlan(), `${imagePath}@${newDigest}`, true)).toThrow()
    const plan = imagePlan()
    plan.resource_changes[0].change.actions = ['no-op']
    plan.resource_changes[0].change.before = structuredClone(plan.resource_changes[0].change.after)
    plan.resource_changes[0].change.after_unknown = {}
    expect(() => assertDeploymentPlan(plan, `${imagePath}@${newDigest}`, true)).not.toThrow()
  })
})

describe('migration履歴', () => {
  const migrations = [
    { name: '001', checksum: 'aaa' },
    { name: '002', checksum: 'bbb' },
  ]
  const success = { migration_name: '001', checksum: 'aaa', finished_at: 'date', rolled_back_at: null }
  test('適用済みの接頭辞と未適用を区別する', () => {
    expect(pendingMigrations(migrations, [success])).toEqual(['002'])
    expect(pendingMigrations(migrations, [])).toEqual(['001', '002'])
  })
  test.each([
    ['失敗済み', [{ ...success, finished_at: null }]],
    ['改変されたSQL', [{ ...success, checksum: 'changed' }]],
    ['未知のmigration', [{ ...success, migration_name: 'unknown' }]],
    ['途中の未適用', [{ ...success, migration_name: '002', checksum: 'bbb' }]],
    ['重複成功', [success, success]],
  ])('%sを拒否する', (_name, history) => {
    expect(() => pendingMigrations(migrations, history)).toThrow()
  })
  test('明示的にrollback済みとされた履歴は成功と数えない', () => {
    expect(pendingMigrations(migrations, [{ ...success, finished_at: null, rolled_back_at: 'date' }])).toEqual(['001', '002'])
  })
})

test('TLS検証とSession poolerの5432番を要求する', () => {
  const url = 'postgresql://postgres:test@localhost:5432/postgres?sslmode=verify-full'
  expect(() => assertDatabaseUrl(url)).not.toThrow()
  for (const invalid of [
    url.replace('verify-full', 'require'),
    url.replace('5432', '6543'),
    `${url}\nJWT_SECRET=unsafe`,
    `${url}&sslmode=require`,
    `${url}&ssl=false`,
  ]) {
    expect(() => assertDatabaseUrl(invalid)).toThrow()
  }
})

test('現行・直前の全保護タグと未知のタグを維持する', () => {
  const old = `sha256:${'c'.repeat(64)}`
  const tags = [
    { tag: 'tags/release-12345678', version: `versions/${oldDigest}` },
    { tag: `tags/release-${'b'.repeat(64)}`, version: `versions/${newDigest}` },
    { tag: 'tags/release-87654321', version: `versions/${old}` },
    { tag: 'tags/release-manual-keep', version: `versions/${old}` },
    { tag: 'tags/candidate-old', version: `versions/${old}` },
  ]
  expect(obsoleteReleaseTags(tags, newDigest, oldDigest)).toEqual([tags[2]])
  expect(() => obsoleteReleaseTags(tags, '', oldDigest)).toThrow()
  expect(() => obsoleteReleaseTags([{ tag: 'tags/release-12345678' }], newDigest, oldDigest)).toThrow()
})
