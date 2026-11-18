import assert from 'node:assert/strict'

/** DB自身の開始・終了時刻から、2つ以上のSQLが重なった時間をミリ秒で求める。 */
export const calculateDatabaseOverlapMs = (intervals) => {
  for (const { startedAt, finishedAt } of intervals) {
    assert(Number.isFinite(startedAt) && Number.isFinite(finishedAt) && finishedAt >= startedAt, 'DBの計測時刻が不正です')
  }
  let overlap = 0
  for (let left = 0; left < intervals.length; left++) {
    for (let right = left + 1; right < intervals.length; right++) {
      overlap = Math.max(
        overlap,
        Math.min(intervals[left].finishedAt, intervals[right].finishedAt) - Math.max(intervals[left].startedAt, intervals[right].startedAt),
      )
    }
  }
  return Math.round(overlap * 1000)
}

/** 同じObjectに同時送信し、HTTP完了だけでなくSQLの実際の重なりと入力の独立性を確認する。 */
export const verifyConcurrency = async (invoke, inputs, passwordKind = 'password', record = () => {}) => {
  const executor = crypto.randomUUID()
  let objectId
  const batches = []
  /** パスワードやハッシュを出力せず、HTTP往復時間と診断情報だけを集計する。 */
  const batch = async (label, mode, operations) => {
    const started = performance.now()
    const settled = await Promise.allSettled(
      operations.map(async ({ kind, body = {}, expected }) => {
        const path = `/measure/${kind}?sample=${crypto.randomUUID()}&executor=${executor}${mode === 'serial' ? '&execution=serial' : ''}`
        const response = await invoke(path, body)
        assert.equal(response.execution.mode, mode, '配備済みの実行方式が異なります')
        assert.match(response.execution.objectId ?? '', /^[0-9a-f]{64}$/, 'Objectの診断IDが不正です')
        objectId ??= response.execution.objectId
        assert.equal(response.execution.objectId, objectId, '異なるObjectへの分散を並行実行と誤認しないでください')
        assert(Number.isInteger(response.execution.activeAtStart) && response.execution.activeAtStart >= 1, '実行中リクエスト数が不正です')
        if (kind.startsWith('password')) assert.equal(response.verified, expected, '並行実行で検証対象の入力が混ざりました')
        else assert.equal(response.ok, true, '並行DB処理が失敗しました')
        return response
      }),
    )
    const totalWallMs = Math.round(performance.now() - started)
    for (const result of settled) if (result.status === 'rejected') throw result.reason
    const responses = settled.map(({ value }) => value)
    const intervals = responses.flatMap(({ databaseInterval }) => (databaseInterval ? [databaseInterval] : []))
    const result = {
      label,
      mode,
      requests: operations.length,
      totalWallMs,
      requestWallMs: responses.map(({ execution }) => execution.requestWallMs),
      activeAtStart: responses.map(({ execution }) => execution.activeAtStart),
      sameObject: true,
      ...(intervals.length ? { databaseOverlapMs: calculateDatabaseOverlapMs(intervals) } : {}),
    }
    batches.push(result)
    record(result)
    return result
  }
  // CPU初期化の時間を比較から分ける。待機SQLを同じObjectで1回実行してから比較する。
  await batch('warmup', 'concurrent', [{ kind: 'database-wait' }])
  const pair = [{ kind: 'database-wait' }, { kind: 'database-wait' }]
  for (let round = 0; round < 3; round++) {
    for (const mode of round % 2 ? ['concurrent', 'serial'] : ['serial', 'concurrent']) {
      const result = await batch(`database-wait-${round + 1}`, mode, pair)
      if (mode === 'serial') {
        assert(result.activeAtStart.every((active) => active === 1) && result.databaseOverlapMs === 0, '比較用の直列経路が直列になっていません')
      }
    }
  }
  await batch(
    'database-model',
    'concurrent',
    Array.from({ length: 4 }, () => ({ kind: 'database-row' })),
  )
  await batch(
    'password-correct',
    'concurrent',
    inputs.map((body) => ({ kind: passwordKind, body, expected: true })),
  )
  await batch(
    'password-incorrect',
    'concurrent',
    inputs.map((input) => ({ kind: passwordKind, body: { ...input, password: `${input.password}!incorrect` }, expected: false })),
  )
  await batch('mixed-database-password', 'concurrent', [
    ...pair,
    { kind: passwordKind, body: inputs[0], expected: true },
    { kind: passwordKind, body: { ...inputs[1], password: `${inputs[1].password}!incorrect` }, expected: false },
  ])
  const overlappingSqlRounds = batches.filter(
    ({ label, mode, activeAtStart, databaseOverlapMs }) =>
      label.startsWith('database-wait-') && mode === 'concurrent' && Math.max(...activeAtStart) >= 2 && databaseOverlapMs > 0,
  ).length
  // 接続プールや到着時刻の差で重ならない回も記録する。少なくとも1回はDB時刻で並行実行を実証する。
  assert(overlappingSqlRounds > 0, '同じObjectでのSQLの並行実行を確認できませんでした')
  return {
    sameObject: true,
    maximumSubmittedRequests: Math.max(...batches.map(({ requests }) => requests)),
    overlappingSqlRounds,
    comparedSqlRounds: 3,
    timing: 'HTTP往復のwall時間。CPU時間ではない',
    batches,
  }
}
