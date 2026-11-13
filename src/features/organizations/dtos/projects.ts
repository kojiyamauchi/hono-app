import { z } from '@hono/zod-openapi'

/**
 * APIレスポンス用のProject DTO。
 * `description` は未設定でもキーを返して `null` とする。日時はISO 8601文字列として扱う。
 * OpenAPI response schemaとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const projectDto = z
  .object({
    id: z.number().int(),
    organizationId: z.number().int(),
    name: z.string(),
    description: z
      .string()
      .nullable()
      .openapi({
        // OpenAPI 3.1ではnullableが無効なため、JSON Schemaの書き方でnull許容を明示する（Zod定義と実行時挙動は変えない）
        type: ['string', 'null'],
        description: 'プロジェクトの説明。未設定はnull。空文字も有効な値。',
      }),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .openapi('Project')

/**
 * GET /organizations/{id}/projects の応答DTO（カーソル式ページネーション）。
 * 次ページの有無は `nextCursor !== null` で表す。
 * OpenAPI response schemaとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const projectListDto = z.object({ items: z.array(projectDto), nextCursor: z.string().nullable() }).openapi('ProjectList')

export type ProjectDtoType = z.infer<typeof projectDto>
export type ProjectListDtoType = z.infer<typeof projectListDto>
