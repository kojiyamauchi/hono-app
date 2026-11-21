import { z } from '@hono/zod-openapi'

import { taskStatuses } from '../entities/tasks'
import { cursorCreatedAtSchema, paginationLimitSchema, POSTGRES_INT_MAX } from './common'

/** 未知の項目を400にするstrictObject用のエラーメッセージ。 */
const unknownKeysError = (issue: { code: string; keys?: string[] }): string | undefined =>
  issue.code === 'unrecognized_keys' ? `指定できない項目が含まれています: ${(issue.keys ?? []).join(', ')}` : undefined

/** タスクのタイトル。前後の空白を除去した後に1〜200文字。 */
const taskTitleSchema = z.string().trim().min(1, 'タイトルは必須です').max(200, 'タイトルは200文字以下で指定してください')

/** タスクの説明。nullは説明なし。空文字は有効な値で、trimや空文字→nullの変換は行わない。最大2,000文字。 */
const taskDescriptionSchema = z
  .string()
  .max(2000, '説明は2000文字以下で指定してください')
  .nullable()
  .openapi({
    // OpenAPI 3.1ではnullableが無効なため、JSON Schemaの書き方でnull許容を明示する（Zod定義と実行時挙動は変えない）
    type: ['string', 'null'],
    // typeの上書きで生成されなくなる文字数制約を、公開仕様に維持する
    maxLength: 2000,
  })

/** タスクの状態。3状態のいずれか。nullや不明な値は不正。 */
const taskStatusSchema = z.enum(taskStatuses, { error: 'statusはTODO・IN_PROGRESS・DONEのいずれかで指定してください' })

/** PostgreSQL INTEGER上限までの正の整数ID（パスパラメータ用）。DBへ渡す前に不正値を400にする。 */
const pathIdSchema = (label: string, name: string): z.ZodType<number> =>
  z.coerce
    .number()
    .int(`${label}は整数で指定してください`)
    .positive(`${label}は1以上で指定してください`)
    .max(POSTGRES_INT_MAX, `${label}は${POSTGRES_INT_MAX}以下で指定してください`)
    .openapi({ param: { name, in: 'path' }, example: 1 })

/**
 * プロジェクト配下のタスク一覧・作成用のパスパラメータ（組織ID・プロジェクトID）のスキーマ。
 * OpenAPI上でpath parameterとして表示するため、`.openapi()` でparamメタデータを付与する。
 */
export const collectionParamSchema = z.object({
  id: pathIdSchema('組織ID', 'id'),
  projectId: pathIdSchema('プロジェクトID', 'projectId'),
})

/**
 * 組織ID・プロジェクトID・タスクIDを含むパスパラメータのスキーマ。
 * OpenAPI上でpath parameterとして表示するため、`.openapi()` でparamメタデータを付与する。
 */
export const itemParamSchema = z.object({
  id: pathIdSchema('組織ID', 'id'),
  projectId: pathIdSchema('プロジェクトID', 'projectId'),
  taskId: pathIdSchema('タスクID', 'taskId'),
})

/**
 * タスク作成ボディのスキーマ。
 * `title` は必須。`description` と `status` は省略可能（省略時はservice層でnull／TODOとして保存する）。未知の項目は400。
 */
export const createBodySchema = z
  .strictObject(
    {
      title: taskTitleSchema,
      description: taskDescriptionSchema.optional(),
      status: taskStatusSchema.optional(),
    },
    { error: unknownKeysError },
  )
  .openapi('CreateTaskRequest')

/**
 * タスク更新ボディのスキーマ。
 * `title` / `description` / `status` のうち少なくとも1項目が必須。省略した項目は維持し、`description: null` は説明の削除を表す。
 * `title: null` と `status: null` は不正。未知の項目は400。
 */
export const updateBodySchema = z
  .strictObject(
    {
      title: taskTitleSchema.optional(),
      description: taskDescriptionSchema.optional(),
      status: taskStatusSchema.optional(),
    },
    { error: unknownKeysError },
  )
  .refine((value) => value.title !== undefined || value.description !== undefined || value.status !== undefined, {
    error: 'title、description、statusの少なくとも1項目を指定してください',
  })
  // 実行時のrefineはOpenAPIに反映されないため、少なくとも1項目が必須の契約をminPropertiesで公開仕様に表す
  .openapi('UpdateTaskRequest', { minProperties: 1 })

/**
 * タスク一覧（カーソル式）のqueryスキーマ。
 * 受け付けるのは `limit`・`cursor`・`status` のみで、`offset` を含む未知のqueryは400。
 * `status` は省略時に全状態、指定時は3状態のいずれか1つ（空文字や不明な状態は不正）。
 */
export const listQuerySchema = z.strictObject(
  {
    limit: paginationLimitSchema.openapi({ param: { name: 'limit', in: 'query', required: false }, example: 20 }),
    cursor: z
      .string()
      .refine((value) => value.trim() !== '', { error: 'cursorは空文字または空白のみでは指定できません' })
      .optional()
      .openapi({ param: { name: 'cursor', in: 'query', required: false } }),
    status: taskStatusSchema.optional().openapi({ param: { name: 'status', in: 'query', required: false } }),
  },
  {
    error: (issue) => (issue.code === 'unrecognized_keys' ? `タスク一覧で指定できないqueryが含まれています: ${issue.keys.join(', ')}` : undefined),
  },
)

/** タスク一覧カーソルのペイロード形式のバージョン。形式を変える場合はここを上げ、旧カーソルを不正として扱う。 */
export const TASK_CURSOR_VERSION = 1

/** タスク一覧カーソルの種別。他APIのカーソルを識別するために必須とする。 */
export const TASK_CURSOR_KIND = 'tasks'

/**
 * タスク一覧カーソルのデコード後ペイロードのスキーマ。
 * 受信値は信用せず、種別・バージョン・対象組織・プロジェクト・状態・境界値の形式をここで検証する。
 * `status` は状態フィルター未指定ならnull。ID類はDBへバインドされるため、PostgreSQL INTEGERの上限も検証する。
 */
export const cursorPayloadSchema = z.object({
  kind: z.literal(TASK_CURSOR_KIND),
  version: z.literal(TASK_CURSOR_VERSION),
  organizationId: z.number().int().positive().max(POSTGRES_INT_MAX),
  projectId: z.number().int().positive().max(POSTGRES_INT_MAX),
  status: z.enum(taskStatuses).nullable(),
  createdAt: cursorCreatedAtSchema,
  id: z.number().int().positive().max(POSTGRES_INT_MAX),
})

export type CollectionParamSchemaType = z.infer<typeof collectionParamSchema>
export type ItemParamSchemaType = z.infer<typeof itemParamSchema>
export type CreateBodySchemaType = z.infer<typeof createBodySchema>
export type UpdateBodySchemaType = z.infer<typeof updateBodySchema>
export type ListQuerySchemaType = z.infer<typeof listQuerySchema>
export type CursorPayloadSchemaType = z.infer<typeof cursorPayloadSchema>
