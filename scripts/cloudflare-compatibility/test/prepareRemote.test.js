import { describe, expect, test } from 'bun:test'

import { assertAccessProtection, createRemoteConfig } from '../prepareRemote.mjs'

/** 適用済みTerraformから出力される公開設定の検証用データ。 */
const output = (overrides = {}) => ({
  account_id: '11111111111111111111111111111111',
  hyperdrive_id: '22222222222222222222222222222222',
  worker_name: 'hono-app-dev-compatibility',
  worker_id: '33333333333333333333333333333333',
  access_application_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  automation_enabled: true,
  access_policy_ids: ['aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb'],
  enable_worker_url: false,
  ...overrides,
})

describe('remote configの生成', () => {
  test('初回はURLを公開せず、ローカル接続文字列や秘密値を持ち込まない', () => {
    const config = createRemoteConfig(output({ localConnectionString: 'private-connection', SPIKE_TOKEN: 'private-token' }))
    expect(config.workers_dev).toBe(false)
    expect(config.preview_urls).toBe(false)
    expect(config.main).toBe('../workerDurable.mjs')
    expect(config.hyperdrive).toEqual([{ binding: 'HYPERDRIVE', id: '22222222222222222222222222222222' }])
    expect(config.vars).toEqual({ ENABLE_DATABASE_CHECK: 'true', PASSWORD_VERIFIER: 'legacy' })
    expect(JSON.stringify(config)).not.toContain('private-')
  })

  test('Accessと自動検証の準備後だけURL有効化を設定できる', () => {
    expect(createRemoteConfig(output({ enable_worker_url: true })).workers_dev).toBe(true)
    expect(() => createRemoteConfig(output({ enable_worker_url: true, automation_enabled: false }))).toThrow()
    expect(() => createRemoteConfig(output({ access_application_id: '' }))).toThrow()
  })

  test('未設定Hyperdriveや意図しないWorker名を拒否する', () => {
    expect(() => createRemoteConfig(output({ hyperdrive_id: '00000000000000000000000000000000' }))).toThrow()
    expect(() => createRemoteConfig(output({ worker_name: 'production-api' }))).toThrow()
    expect(() => createRemoteConfig(output({ worker_id: '11111111-2222-3333-4444-555555555555' }))).toThrow()
  })

  test('Wasmを同時に初期化しないよう、比較用の実装を明示配備時だけ有効化する', () => {
    expect(createRemoteConfig(output(), 'native').vars.PASSWORD_VERIFIER).toBe('native')
    expect(() => createRemoteConfig(output(), 'unknown')).toThrow()
  })

  test('Durable ObjectsはFreeで使えるSQLite型だけを作り、比較用compilerは別entryに分離する', () => {
    const durable = createRemoteConfig(output(), 'legacy', 'durable')
    expect(durable.main).toBe('../workerDurable.mjs')
    expect(durable.migrations).toEqual([{ tag: 'compatibility-executor-v1', new_sqlite_classes: ['CompatibilityExecutor'] }])
    expect(durable.durable_objects.bindings).toEqual([{ name: 'COMPATIBILITY_EXECUTOR', class_name: 'CompatibilityExecutor' }])
    expect(createRemoteConfig(output(), 'legacy', 'lean-fast').main).toBe('../workerLean.mjs')
    expect(createRemoteConfig(output(), 'legacy', 'lean-small').main).toBe('../workerLeanSmall.mjs')
    expect(() => createRemoteConfig(output(), 'legacy', 'unknown')).toThrow()
  })

  test('配備前のAccess削除・別Workerへの付け替え・ポリシー差異・Bypassを拒否する', () => {
    const current = {
      type: 'self_hosted',
      destinations: [{ type: 'worker', worker_id: output().worker_id }],
      policies: [{ id: output().access_policy_ids[0], decision: 'allow' }],
      options_preflight_bypass: false,
    }
    expect(() => assertAccessProtection(output(), current)).not.toThrow()
    expect(() => assertAccessProtection(output(), { ...current, destinations: [] })).toThrow()
    expect(() => assertAccessProtection(output(), { ...current, destinations: [{ type: 'worker', worker_id: 'other-worker' }] })).toThrow()
    expect(() => assertAccessProtection(output(), { ...current, policies: [] })).toThrow()
    expect(() => assertAccessProtection(output(), { ...current, policies: [{ id: output().access_policy_ids[0], decision: 'bypass' }] })).toThrow()
    expect(() => assertAccessProtection(output(), { ...current, options_preflight_bypass: true })).toThrow()
    expect(() => assertAccessProtection(output(), { ...current, read_service_tokens_from_header: 'Authorization' })).toThrow()
  })
})
