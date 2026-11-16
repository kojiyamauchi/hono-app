import { z } from '@hono/zod-openapi'

/**
 * 組織IDパスパラメータのバリデーションスキーマ。
 * OpenAPI上でpath parameterとして表示するため、`.openapi()` でparamメタデータを付与する。
 */
export const idParamSchema = z.object({
  id: z.coerce
    .number()
    .int('組織IDは整数で指定してください')
    .positive('組織IDは1以上で指定してください')
    .openapi({ param: { name: 'id', in: 'path' }, example: 1 }),
})

/**
 * PostgreSQLのINTEGER（int4）の上限値。
 * IDカラムはINTEGERのため、これを超える値をDBへ渡すと整数変換に失敗して500になる。
 * 外部入力のIDをDBへ渡す前に、この値以下へ制限して400にするために使う。
 */
export const POSTGRES_INT_MAX = 2147483647

/**
 * ページネーションの数値queryを `z.coerce.number()` へ渡す前の前処理。
 * `Number('')` と `Number(' ')` と `Number(null)` はいずれも0になるため、
 * 明示された空文字・空白・nullが既定値や0として通ってしまう（`offset=` が200で先頭ページになる）。
 * 未指定（`undefined`）だけを `.default()` へ委ね、それ以外はNaNへ寄せて400にする。
 */
export const rejectBlankNumericQuery = (value: unknown): unknown => (value === null || (typeof value === 'string' && value.trim() === '') ? Number.NaN : value)

/** ページネーション共通のlimit。省略時20、1〜100の整数。複数のリソースの一覧schemaから再利用する。 */
export const paginationLimitSchema = z.preprocess(
  rejectBlankNumericQuery,
  z.coerce.number().int('limitは整数で指定してください').min(1, 'limitは1以上で指定してください').max(100, 'limitは100以下で指定してください').default(20),
)

/**
 * カーソルの境界日時のスキーマ（メンバー一覧・監査ログ一覧・プロジェクト一覧で共通）。
 * `z.iso.datetime()` は4桁年を許容するため0年（`0000-01-01T00:00:00.000Z`）も通る。
 * PostgreSQLに0年は存在せず、Dateとしてバインドすると `22008 date/time field value out of range` で
 * 500になる。カーソルはクライアントが改変できる入力のため、DBへ渡す前にここで弾いて400にする。
 */
export const cursorCreatedAtSchema = z.iso.datetime().refine((value) => new Date(value).getUTCFullYear() >= 1, { error: 'カーソルの日時が範囲外です' })

export type IdParamSchemaType = z.infer<typeof idParamSchema>
