import type { OpenAPIHono } from '@hono/zod-openapi'
import { Scalar } from '@scalar/hono-api-reference'

/** Scalar UIを root app の /open-api/scalar へ登録する。内部で /open-api/doc を読み込む。 */
export const registerScalarRoute = (app: OpenAPIHono): void => {
  app.get('/open-api/scalar', Scalar({ url: '/open-api/doc', proxyUrl: '', persistAuth: false }))
}
