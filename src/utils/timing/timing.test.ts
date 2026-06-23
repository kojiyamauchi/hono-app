import { describe, expect, test } from 'bun:test'

import { PASSWORD_RESET_JITTER_MAX_MS, PASSWORD_RESET_MIN_DELAY_MS, passwordResetRequestDelayMs } from '.'

describe('passwordResetRequestDelayMs', () => {
  test('経過時間が最低応答時間未満のとき、残り時間＋ジッターを返す', () => {
    // 経過時間 50ms、最低 250ms → 残り 200ms + jitter
    const delay = passwordResetRequestDelayMs(50, 0)

    expect(delay).toBe(PASSWORD_RESET_MIN_DELAY_MS - 50)
  })

  test('ジッター注入: 残り時間＋指定ジッターが返される', () => {
    const delay = passwordResetRequestDelayMs(100, 75)

    // 残り 250-100=150ms + jitter 75ms = 225ms
    expect(delay).toBe(150 + 75)
  })

  test('経過時間が最低応答時間ちょうどのとき、0＋ジッターを返す', () => {
    const delay = passwordResetRequestDelayMs(PASSWORD_RESET_MIN_DELAY_MS, 30)

    expect(delay).toBe(30)
  })

  test('経過時間が最低応答時間を超えるとき、0＋ジッターを返す（負の遅延にならない）', () => {
    // elapsedMs が floor を超えた場合でも負値にならない
    const delay = passwordResetRequestDelayMs(PASSWORD_RESET_MIN_DELAY_MS + 100, 0)

    expect(delay).toBe(0)
  })

  test('ジッター省略時は 0〜JITTER_MAX_MS の範囲のランダム値が加算される', () => {
    // ジッターを省略してもNaN・負値にならないことを確認する
    for (let i = 0; i < 20; i++) {
      const delay = passwordResetRequestDelayMs(0)
      expect(delay).toBeGreaterThanOrEqual(PASSWORD_RESET_MIN_DELAY_MS)
      expect(delay).toBeLessThanOrEqual(PASSWORD_RESET_MIN_DELAY_MS + PASSWORD_RESET_JITTER_MAX_MS)
    }
  })

  test('経過時間が十分大きいとき、ジッター省略でも 0〜JITTER_MAX_MS の範囲になる', () => {
    for (let i = 0; i < 20; i++) {
      const delay = passwordResetRequestDelayMs(PASSWORD_RESET_MIN_DELAY_MS + 500)
      expect(delay).toBeGreaterThanOrEqual(0)
      expect(delay).toBeLessThanOrEqual(PASSWORD_RESET_JITTER_MAX_MS)
    }
  })
})
