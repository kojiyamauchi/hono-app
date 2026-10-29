import { describe, expect, test } from 'bun:test'

import { assertDeploymentPlan } from './gcp-cd-policy.mjs'
import { imagePath, imagePlan, newDigest } from './gcp-cd-fixtures.js'

/** 実測と同じ、対象Registryの更新日時だけが変わるdriftを作る。 */
function registryDrift() {
  const before = {
    project: 'hono-app-dev-512908-f3',
    location: 'asia-northeast1',
    repository_id: 'hono-app-dev',
    cleanup_policies: [],
    update_time: '2026-10-28T09:33:20.357411Z',
  }
  return {
    address: 'google_artifact_registry_repository.app',
    mode: 'managed',
    type: 'google_artifact_registry_repository',
    change: { actions: ['update'], before, after: { ...structuredClone(before), update_time: '2026-10-29T18:54:32.292329Z' }, after_unknown: {} },
  }
}

describe('Registry更新日時の限定的なdrift許容', () => {
  test('対象Registryの更新日時だけを許可する', () => {
    const plan = imagePlan()
    plan.resource_drift = [registryDrift()]
    expect(() => assertDeploymentPlan(plan, `${imagePath}@${newDigest}`)).not.toThrow()
  })
  test('配備後も設定差分なしのまま更新日時だけを許可する', () => {
    const plan = imagePlan()
    plan.resource_drift = [registryDrift()]
    const change = plan.resource_changes[0].change
    change.actions = ['no-op']
    change.before = structuredClone(change.after)
    change.after_unknown = {}
    expect(() => assertDeploymentPlan(plan, `${imagePath}@${newDigest}`, true)).not.toThrow()
  })
  test.each([
    [
      'cleanup設定変更',
      (drift) => {
        drift.change.after.cleanup_policies = [{ id: 'unexpected' }]
      },
    ],
    [
      '別リソース',
      (drift) => {
        drift.address = 'google_artifact_registry_repository.other'
      },
    ],
    [
      'IAMのdrift',
      (drift) => {
        drift.address = 'google_project_iam_member.cd_read[0]'
        drift.type = 'google_project_iam_member'
      },
    ],
    [
      '未知の設定値',
      (drift) => {
        drift.change.after_unknown.cleanup_policies = true
      },
    ],
    [
      'managed以外の差分',
      (drift) => {
        drift.mode = 'data'
      },
    ],
    [
      '異なるリソース型',
      (drift) => {
        drift.type = 'google_project_iam_member'
      },
    ],
    [
      '未確定の更新日時',
      (drift) => {
        drift.change.after_unknown.update_time = true
      },
    ],
    [
      '変更前の値がない差分',
      (drift) => {
        drift.change.before = null
      },
    ],
    [
      '変更後の値がない差分',
      (drift) => {
        drift.change.after = null
      },
    ],
    [
      '更新日時以外の計算属性',
      (drift) => {
        drift.change.after.etag = 'unexpected'
      },
    ],
    [
      '置換',
      (drift) => {
        drift.change.actions = ['delete', 'create']
      },
    ],
    [
      'リソース削除',
      (drift) => {
        drift.change.actions = ['delete']
      },
    ],
  ])('%sは更新日時と同時でも拒否する', (_name, mutate) => {
    const plan = imagePlan()
    const drift = registryDrift()
    mutate(drift)
    plan.resource_drift = [drift]
    expect(() => assertDeploymentPlan(plan, `${imagePath}@${newDigest}`)).toThrow()
  })
  test('resource_changesのRegistry更新を許可しない', () => {
    const plan = imagePlan()
    const drift = registryDrift()
    plan.resource_drift = [drift]
    plan.resource_changes.push(drift)
    expect(() => assertDeploymentPlan(plan, `${imagePath}@${newDigest}`)).toThrow()
  })
})
