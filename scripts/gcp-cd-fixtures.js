export const oldDigest = `sha256:${'a'.repeat(64)}`
export const newDigest = `sha256:${'b'.repeat(64)}`
export const imagePath = 'asia-northeast1-docker.pkg.dev/hono-app-dev-512908-f3/hono-app-dev/hono'

/** providerのplan形式で、設定と再計算される出力属性を含む検証用planを作る。 */
export function imagePlan() {
  const before = {
    project: 'hono-app-dev-512908-f3',
    location: 'asia-northeast1',
    name: 'hono-app-dev',
    iap_enabled: true,
    invoker_iam_disabled: false,
    deletion_protection: true,
    generation: '1',
    template: [{ revision: 'old-revision', service_account: 'runtime@example.com', containers: [{ image: `${imagePath}@${oldDigest}`, env: [] }] }],
  }
  const after = structuredClone(before)
  after.template[0].containers[0].image = `${imagePath}@${newDigest}`
  after.template[0].revision = null
  after.generation = null
  return {
    format_version: '1.2',
    complete: true,
    errored: false,
    resource_changes: [
      {
        address: 'google_cloud_run_v2_service.app[0]',
        type: 'google_cloud_run_v2_service',
        mode: 'managed',
        change: {
          actions: ['update'],
          before,
          after,
          after_unknown: { generation: true, template: [{ revision: true, containers: [{ image: false }] }] },
        },
      },
    ],
    output_changes: {},
  }
}
