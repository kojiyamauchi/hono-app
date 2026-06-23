/**
 * タイミング緩和ユーティリティ。
 * 同期送信による登録済み・未登録の処理時間差を緩和するための遅延計算を提供する。
 */

/** 最低応答時間（ミリ秒）。 */
export const PASSWORD_RESET_MIN_DELAY_MS = 250

/** ジッターの最大値（ミリ秒）。0〜この値のランダム遅延を加算する。 */
export const PASSWORD_RESET_JITTER_MAX_MS = 100

/**
 * パスワードリセットリクエストの残り遅延時間を計算する純粋関数。
 *
 * 最低応答時間を下回る場合は残り時間＋ランダムジッターを返し、
 * 最低応答時間以上の場合は0〜ジッター最大値のランダム値を返す。
 * これにより、登録済み・未登録の処理時間差が外部から観測されにくくなる。
 *
 * @param elapsedMs - 処理開始からの経過時間（ミリ秒）
 * @param jitter - 外部から注入するジッター値（0〜PASSWORD_RESET_JITTER_MAX_MS）。省略時はランダム生成。
 * @returns 待機すべきミリ秒数（0以上）
 */
export const passwordResetRequestDelayMs = (elapsedMs: number, jitter?: number): number => {
  const resolvedJitter = jitter ?? Math.random() * PASSWORD_RESET_JITTER_MAX_MS
  const remaining = PASSWORD_RESET_MIN_DELAY_MS - elapsedMs
  if (remaining > 0) {
    return remaining + resolvedJitter
  }
  return resolvedJitter
}
