import { z } from '@hono/zod-openapi'
import type { MiddlewareHandler } from 'hono'
import { createMiddleware } from 'hono/factory'

import { AppError } from '@/utils/errors'

/**
 * パスパラメータ検証ミドルウェアのファクトリ。
 *
 * OpenAPIHono では route の `middleware` が `request.params` の検証より先に実行される。
 * そのため、パスパラメータに依存する後続ミドルウェア（例: organizationMembershipMiddleware）を
 * `middleware` に置くと、不正なパラメータが検証前に後続へ渡り、本来400であるべき入力が
 * 404などへ退行する。これを防ぐため、後続ミドルウェアより前にこのミドルウェアを差し込み、
 * route の param schema 全体（複数paramを含む）を先に検証する。
 *
 * 検証失敗時は onValidationError / openApiDefaultHook と同じ `{ error: { message } }`（400）形式で応答する。
 * 検証に成功した場合、値の取り出しは従来どおり後続の `c.req.valid('param')` を使う（本ミドルウェアはcontextへ格納しない）。
 */
export const paramValidationMiddleware = (schema: z.ZodType): MiddlewareHandler =>
  createMiddleware(async (c, next) => {
    const result = schema.safeParse(c.req.param())
    if (!result.success) {
      throw new AppError(400, result.error.issues[0]?.message ?? '入力値が正しくありません')
    }
    await next()
  })
