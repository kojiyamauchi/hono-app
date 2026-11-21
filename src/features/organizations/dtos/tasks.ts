import { z } from '@hono/zod-openapi'

import { taskStatuses } from '../entities/tasks'

/**
 * APIレスポンス用のTask DTO（7項目）。
 * `description` は未設定でもキーを返して `null` とする。日時はISO 8601文字列として扱う。
 * OpenAPI response schemaとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const itemDto = z
  .object({
    id: z.number().int(),
    projectId: z.number().int(),
    title: z.string(),
    description: z
      .string()
      .nullable()
      .openapi({
        // OpenAPI 3.1ではnullableが無効なため、JSON Schemaの書き方でnull許容を明示する（Zod定義と実行時挙動は変えない）
        type: ['string', 'null'],
        description: 'タスクの説明。未設定はnull。空文字も有効な値。',
      }),
    status: z.enum(taskStatuses).openapi({ description: 'タスクの状態。TODO（未着手）／IN_PROGRESS（進行中）／DONE（完了）。' }),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .openapi('Task')

/**
 * GET /organizations/{id}/projects/{projectId}/tasks の応答DTO（カーソル式ページネーション）。
 * 次ページの有無は `nextCursor !== null` で表す。
 * OpenAPI response schemaとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const listDto = z
  .object({
    items: z.array(itemDto),
    nextCursor: z
      .string()
      .nullable()
      .openapi({
        // OpenAPI 3.1ではnullableが無効なため、JSON Schemaの書き方でnull許容を明示する（Zod定義と実行時挙動は変えない）
        type: ['string', 'null'],
      }),
  })
  .openapi('TaskList')

export type ItemDtoType = z.infer<typeof itemDto>
export type ListDtoType = z.infer<typeof listDto>
