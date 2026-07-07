import type { OpenAPIHono } from '@hono/zod-openapi'
import { Scalar } from '@scalar/hono-api-reference'

import { bearerAuthScheme, cookieAuthScheme, SECURITY_SCHEME } from '@/shared/openApi/schemes'

/*
 * このfeatureは例外的に、Honoサブアプリを app.route() で mount する通常のfeature routesではなく、
 * root app（OpenAPIHono）を受け取って /open-api/doc・/open-api/scalar を登録する「登録関数」型にしている。
 * 理由: OpenAPI仕様は各featureの route定義が root app の registry へ集約されて初めて全体が揃う。
 * openApiを子アプリとして mount すると、その子は自分自身の route しか見えず /doc が全endpointを網羅できない。
 * よって doc生成は root app の責務であり、registerOpenApiRoutes は root app を引数に受け取る。
 * この逸脱の正当化は AGENTS.md / CLAUDE.md / README.md を参照。
 */

/** ENABLE_API_DOCS=true のときだけ /open-api/doc(OpenAPI JSON) と /open-api/scalar(Scalar UI) を root app へ登録する。 */
export const registerOpenApiRoutes = (app: OpenAPIHono): void => {
  if (process.env.ENABLE_API_DOCS !== 'true') {
    return
  }

  // Bearer（アクセストークン）/ Cookie（リフレッシュトークン）の認証方式を登録する。
  // 各endpointへのsecurity付与は #118 で行う。
  app.openAPIRegistry.registerComponent('securitySchemes', SECURITY_SCHEME.bearer, bearerAuthScheme)
  app.openAPIRegistry.registerComponent('securitySchemes', SECURITY_SCHEME.cookie, cookieAuthScheme)

  // OpenAPI JSONを /open-api/doc で動的生成する。
  app.doc('/open-api/doc', {
    openapi: '3.1.0',
    info: {
      title: 'hono-app API',
      version: '0.1.0',
    },
  })

  // Scalar UIを /open-api/scalar で提供し、内部で /open-api/doc を読み込む。
  app.get('/open-api/scalar', Scalar({ url: '/open-api/doc' }))
}
