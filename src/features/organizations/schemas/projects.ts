import { z } from '@hono/zod-openapi'

import { cursorCreatedAtSchema, paginationLimitSchema, POSTGRES_INT_MAX } from '.'

/** 未知の項目を400にするstrictObject用のエラーメッセージ。 */
const unknownKeysError = (issue: { code: string; keys?: string[] }): string | undefined =>
  issue.code === 'unrecognized_keys' ? `指定できない項目が含まれています: ${(issue.keys ?? []).join(', ')}` : undefined

/** プロジェクト名。前後の空白を除去した後に1〜100文字。 */
const projectNameSchema = z.string().trim().min(1, 'プロジェクト名は必須です').max(100, 'プロジェクト名は100文字以下で指定してください')

/** プロジェクトの説明。nullは説明なし。空文字は有効な値で、trimや空文字→nullの変換は行わない。最大2,000文字。 */
const projectDescriptionSchema = z
  .string()
  .max(2000, '説明は2000文字以下で指定してください')
  .nullable()
  .openapi({
    // OpenAPI 3.1ではnullableが無効なため、JSON Schemaの書き方でnull許容を明示する（Zod定義と実行時挙動は変えない）
    type: ['string', 'null'],
  })

/** PostgreSQL INTEGER上限までの正の整数ID（パスパラメータ用）。DBへ渡す前に不正値を400にする。 */
const idParamSchema = (label: string, name: string): z.ZodType<number> =>
  z.coerce
    .number()
    .int(`${label}は整数で指定してください`)
    .positive(`${label}は1以上で指定してください`)
    .max(POSTGRES_INT_MAX, `${label}は${POSTGRES_INT_MAX}以下で指定してください`)
    .openapi({ param: { name, in: 'path' }, example: 1 })

/**
 * 組織配下のプロジェクト一覧・作成用のパスパラメータ（組織ID）のスキーマ。
 * OpenAPI上でpath parameterとして表示するため、`.openapi()` でparamメタデータを付与する。
 */
export const projectsRouteParamSchema = z.object({
  id: idParamSchema('組織ID', 'id'),
})

/**
 * 組織IDとプロジェクトIDを含むパスパラメータのスキーマ。
 * OpenAPI上でpath parameterとして表示するため、`.openapi()` でparamメタデータを付与する。
 */
export const projectRouteParamSchema = z.object({
  id: idParamSchema('組織ID', 'id'),
  projectId: idParamSchema('プロジェクトID', 'projectId'),
})

/**
 * プロジェクト作成ボディのスキーマ。
 * `description` は省略可能でnullを許容する（省略時はservice層でnullとして保存する）。未知の項目は400。
 */
export const createProjectBodySchema = z
  .strictObject(
    {
      name: projectNameSchema,
      description: projectDescriptionSchema.optional(),
    },
    { error: unknownKeysError },
  )
  .openapi('CreateProjectRequest')

/**
 * プロジェクト更新ボディのスキーマ。
 * `name` / `description` のうち少なくとも1項目が必須。省略した項目は維持し、`description: null` は説明の削除を表す。
 * `name: null` は不正。未知の項目は400。
 */
export const updateProjectBodySchema = z
  .strictObject(
    {
      name: projectNameSchema.optional(),
      description: projectDescriptionSchema.optional(),
    },
    { error: unknownKeysError },
  )
  .refine((value) => value.name !== undefined || value.description !== undefined, {
    error: 'nameまたはdescriptionの少なくとも1項目を指定してください',
  })
  .openapi('UpdateProjectRequest')

/**
 * プロジェクト一覧（カーソル式）のqueryスキーマ。
 * 受け付けるのは `limit` と `cursor` のみで、`offset` を含む未知のqueryは400。
 */
export const listProjectsQuerySchema = z.strictObject(
  {
    limit: paginationLimitSchema.openapi({ param: { name: 'limit', in: 'query', required: false }, example: 20 }),
    cursor: z
      .string()
      .refine((value) => value.trim() !== '', { error: 'cursorは空文字または空白のみでは指定できません' })
      .optional()
      .openapi({ param: { name: 'cursor', in: 'query', required: false } }),
  },
  {
    error: (issue) =>
      issue.code === 'unrecognized_keys' ? `プロジェクト一覧はカーソル式のため、指定できないqueryが含まれています: ${issue.keys.join(', ')}` : undefined,
  },
)

/** プロジェクト一覧カーソルのペイロード形式のバージョン。形式を変える場合はここを上げ、旧カーソルを不正として扱う。 */
export const PROJECT_CURSOR_VERSION = 1

/** プロジェクト一覧カーソルの種別。メンバー一覧など同じ形の別APIのカーソルを識別するために必須とする。 */
export const PROJECT_CURSOR_KIND = 'projects'

/**
 * プロジェクト一覧カーソルのデコード後ペイロードのスキーマ。
 * 受信値は信用せず、種別・バージョン・対象組織・境界値の形式をここで検証する。
 * `organizationId` と `id` はDBへバインドされるため、PostgreSQL INTEGERの上限も検証する。
 */
export const projectCursorPayloadSchema = z.object({
  kind: z.literal(PROJECT_CURSOR_KIND),
  version: z.literal(PROJECT_CURSOR_VERSION),
  organizationId: z.number().int().positive().max(POSTGRES_INT_MAX),
  createdAt: cursorCreatedAtSchema,
  id: z.number().int().positive().max(POSTGRES_INT_MAX),
})

export type ProjectsRouteParamSchemaType = z.infer<typeof projectsRouteParamSchema>
export type ProjectRouteParamSchemaType = z.infer<typeof projectRouteParamSchema>
export type CreateProjectBodySchemaType = z.infer<typeof createProjectBodySchema>
export type UpdateProjectBodySchemaType = z.infer<typeof updateProjectBodySchema>
export type ListProjectsQuerySchemaType = z.infer<typeof listProjectsQuerySchema>
export type ProjectCursorPayloadSchemaType = z.infer<typeof projectCursorPayloadSchema>
