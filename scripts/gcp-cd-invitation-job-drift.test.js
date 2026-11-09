import { describe, expect, test } from 'bun:test'

import { assertDeploymentPlan } from './gcp-cd-policy.mjs'

import { imagePath, imagePlan, newDigest } from './gcp-cd-fixtures.js'

/** 招待メールJobを定期実行したときの計算属性の変化を再現する。 */
function executionDrift() {
  const before = {
    project: 'hono-app-dev-512908-f3',
    location: 'asia-northeast1',
    name: 'hono-app-dev-invite-worker',
    template: [{ template: [{ containers: [{ image: `${imagePath}@${newDigest}` }] }] }],
    execution_count: 0,
    latest_created_execution: [],
  }
  return {
    address: 'google_cloud_run_v2_job.invitation_email[0]',
    mode: 'managed',
    type: 'google_cloud_run_v2_job',
    change: {
      actions: ['update'],
      before,
      after: { ...structuredClone(before), execution_count: 1, latest_created_execution: [{ name: 'worker-execution' }] },
      after_unknown: {},
    },
  }
}

describe('招待メールJobの実行履歴', () => {
  test('Serviceのイメージ更新とJobの実行履歴のみのrefreshを許可する', () => {
    const plan = imagePlan()
    plan.resource_drift = [executionDrift()]
    expect(() => assertDeploymentPlan(plan, `${imagePath}@${newDigest}`)).not.toThrow()
  })

  test('配備後の再planでもJobの実行履歴のみのrefreshを許可する', () => {
    const plan = imagePlan()
    plan.resource_drift = [executionDrift()]
    const change = plan.resource_changes[0].change
    change.actions = ['no-op']
    change.before = structuredClone(change.after)
    change.after_unknown = {}
    expect(() => assertDeploymentPlan(plan, `${imagePath}@${newDigest}`, true)).not.toThrow()
  })

  test.each([
    [
      'Jobのdigest変更',
      (drift) => {
        drift.change.after.template[0].template[0].containers[0].image = 'changed'
      },
    ],
    [
      '別のJobの実行履歴',
      (drift) => {
        drift.address = 'google_cloud_run_v2_job.other[0]'
      },
    ],
    [
      'Schedulerの停止変更',
      (drift) => {
        drift.address = 'google_cloud_scheduler_job.invitation_email[0]'
        drift.type = 'google_cloud_scheduler_job'
        drift.change.after.paused = true
      },
    ],
    [
      '未確定の設定',
      (drift) => {
        drift.change.after_unknown.template = true
      },
    ],
    [
      'Jobの削除',
      (drift) => {
        drift.change.actions = ['delete']
        drift.change.after = null
      },
    ],
  ])('%sは拒否する', (_name, mutate) => {
    const plan = imagePlan()
    const drift = executionDrift()
    mutate(drift)
    plan.resource_drift = [drift]
    expect(() => assertDeploymentPlan(plan, `${imagePath}@${newDigest}`)).toThrow()
  })

  test('Job自体の適用は許可しない', () => {
    const plan = imagePlan()
    plan.resource_changes.push(executionDrift())
    expect(() => assertDeploymentPlan(plan, `${imagePath}@${newDigest}`)).toThrow()
  })
})
