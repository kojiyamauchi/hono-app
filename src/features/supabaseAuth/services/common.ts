import type { User } from '@supabase/supabase-js'

/**
 * 認証結果（アクセストークンとユーザー情報）。
 */
export type AuthResult = {
  token: string | null
  user: User | null
}
