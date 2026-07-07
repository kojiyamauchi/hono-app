import { z } from '@hono/zod-openapi'

/**
 * アプリ共通のエラーレスポンスDTO。
 * onError / onValidationError が返す統一エラー形式 `{ error: { message } }` に一致させる。
 * #118 の各feature routesが、エラーレスポンス（400 / 401 / 404 / 500 など）のschemaとして参照する。
 */
export const errorResponseDto = z
  .object({
    error: z.object({
      message: z.string(),
    }),
  })
  .openapi('ErrorResponse')

export type ErrorResponseDtoType = z.infer<typeof errorResponseDto>
