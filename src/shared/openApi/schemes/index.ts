/*
 * schemes/ は標準8ディレクトリに含まれない例外的な責務ディレクトリ。
 * OpenAPIのsecurity scheme（＝認証「方式」の定義）を置く。
 * リポジトリ標準の schemas/ は「request body / query / param などのZod入力検証schema（＝データの構造）」
 * を置く場所であり責務が異なるため、scheme（方式）と schema（構造）を混在させず別名 schemes/ に分離している。
 * この例外の追加経緯・正当化は AGENTS.md / CLAUDE.md / README.md を参照。
 */

/**
 * OpenAPI security scheme名。
 * #118 の各feature routesが `security` 指定でこの名前を参照する。
 */
export const SECURITY_SCHEME = {
  bearer: 'bearerAuth',
  cookie: 'cookieAuth',
} as const

/** アクセストークン（Authorization: Bearer）用の認証方式。 */
export const bearerAuthScheme = {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
} as const

/**
 * リフレッシュトークンCookie用の認証方式。
 * name は shared/auth の REFRESH_TOKEN_COOKIE_NAME（'refreshToken'）と一致させること。
 * shared domain間の相互依存を避けるためimportせずリテラルで持つ。
 */
export const cookieAuthScheme = {
  type: 'apiKey',
  in: 'cookie',
  name: 'refreshToken',
} as const
