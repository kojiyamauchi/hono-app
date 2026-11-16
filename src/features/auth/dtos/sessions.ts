import { z } from '@hono/zod-openapi'

import { sessionDto } from '@/shared/auth/dtos'

/**
 * GET /auth/sessions の応答DTO（activeなリフレッシュセッション一覧）。
 * OpenAPI response schemaとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const listDto = z.object({ sessions: z.array(sessionDto) }).openapi('SessionList')

export type ListDtoType = z.infer<typeof listDto>
