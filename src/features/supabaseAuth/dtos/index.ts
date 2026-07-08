import { z } from '@hono/zod-openapi'

/**
 * Supabase Auth（`@supabase/supabase-js`）が返す `User` の文書化サブセットDTO。
 * `User` は構造的にこのDTOのスーパーセットのため、余剰プロパティを許容したまま代入できる。
 * identities/factors 等の内部的なノイズは含めず、OpenAPI response schemaとして意味のある
 * フィールドだけを公開する。optionalの有無は `User` の定義（@supabase/auth-js の型定義）に合わせる。
 * OpenAPI response schemaとして参照するため、`.openapi()` でcomponent名を付与する。
 */
const supabaseUserShape = z.object({
  id: z.string(),
  aud: z.string(),
  email: z.string().optional(),
  phone: z.string().optional(),
  role: z.string().optional(),
  app_metadata: z.record(z.string(), z.any()),
  user_metadata: z.record(z.string(), z.any()),
  created_at: z.string(),
  updated_at: z.string().optional(),
  email_confirmed_at: z.string().optional(),
  last_sign_in_at: z.string().optional(),
  is_anonymous: z.boolean().optional(),
})

export const supabaseUserDto = supabaseUserShape.openapi('SupabaseUser')

export type SupabaseUserDtoType = z.infer<typeof supabaseUserDto>

/**
 * null許容のSupabase User DTO（サインアップ/ログインの `user` 用）。
 * `.openapi('SupabaseUser')` 済みのschemaへ直接 `.nullable()` を重ねると、共有される
 * `SupabaseUser` component自体に `nullable: true` が伝播し、null を返さない `/me` の
 * 200 responseまで `SupabaseUser | null` として公開されてしまう。これを避けるため、
 * base shape から nullable を別componentとして分離する。
 */
const nullableSupabaseUserDto = supabaseUserShape.nullable().openapi('NullableSupabaseUser')

/**
 * Supabase Auth の認証結果DTO（サインアップ/ログイン共通）。
 * serviceの `AuthResult`（`{ token: string | null, user: User | null }`）と整合させる。
 * OpenAPI response schemaとして参照するため、`.openapi()` でcomponent名を付与する。
 */
export const authResultDto = z
  .object({
    token: z.string().nullable(),
    user: nullableSupabaseUserDto,
  })
  .openapi('SupabaseAuthResult')

export type AuthResultDtoType = z.infer<typeof authResultDto>
