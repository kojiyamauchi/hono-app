import type { Context } from 'hono'

/**
 * バリデーションフックが受け取る検証結果（必要な部分のみ）。
 * @hono/zod-validator の hook と @hono/zod-openapi の defaultHook の双方の結果を、
 * 共通で扱える最小構造として表現する。
 */
type ValidationResult = {
  success: boolean
  error?: {
    issues: { message: string }[]
  }
}

/**
 * バリデーション失敗時に、アプリ共通のエラー形式 `{ error: { message } }` で400を返す。
 * onValidationError（zod-validator）と openApiDefaultHook（zod-openapi）で共通利用する。
 */
const respondValidationError = (result: ValidationResult, c: Context): Response | undefined => {
  if (!result.success) {
    const message = result.error?.issues[0]?.message ?? '入力値が正しくありません'
    return c.json({ error: { message } }, 400)
  }
  return undefined
}

/**
 * @hono/zod-validator 用の共通フック。
 * バリデーション失敗時に、アプリ共通のエラー形式 `{ error: { message } }` で400を返す。
 */
export const onValidationError = (result: ValidationResult, c: Context): Response | undefined => {
  return respondValidationError(result, c)
}

/**
 * @hono/zod-openapi（OpenAPIHono）用の defaultHook。
 * `createRoute` / `openapi` へ移行したルートでも、既存の onValidationError と同じ
 * バリデーションエラー形式 `{ error: { message } }`（400）を維持するために利用する。
 */
export const openApiDefaultHook = (result: ValidationResult, c: Context): Response | undefined => {
  return respondValidationError(result, c)
}
