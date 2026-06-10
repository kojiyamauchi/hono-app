import type { Context } from 'hono'

/**
 * @hono/zod-validator のフックが受け取るバリデーション結果（必要な部分のみ）。
 */
type ValidationResult = {
  success: boolean
  error?: {
    issues: { message: string }[]
  }
}

/**
 * @hono/zod-validator 用の共通フック。
 * バリデーション失敗時に、アプリ共通のエラー形式 `{ error: { message } }` で400を返す。
 */
export const onValidationError = (result: ValidationResult, c: Context): Response | undefined => {
  if (!result.success) {
    const message = result.error?.issues[0]?.message ?? '入力値が正しくありません'
    return c.json({ error: { message } }, 400)
  }
  return undefined
}

/**
 * @hono/zod-validator 用のボディバリデーションフック。
 * 意味的に不正な値（例: OWNERロールの直接指定）に対して422を返す。
 */
export const onBodyValidationError = (result: ValidationResult, c: Context): Response | undefined => {
  if (!result.success) {
    const message = result.error?.issues[0]?.message ?? '入力値が正しくありません'
    return c.json({ error: { message } }, 422)
  }
  return undefined
}
