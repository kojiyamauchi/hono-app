import type { User } from '@supabase/supabase-js'

import { supabase } from '@/libs/supabase'
import { AppError } from '@/utils/errors'

import type { LoginInput, SignupInput } from '../schemas'

/**
 * 認証結果（アクセストークンとユーザー情報）。
 */
type AuthResult = {
  token: string | null
  user: User | null
}

/**
 * Supabase Auth を利用した認証ロジック（BFFパターン）。
 * Hono が内部で Supabase Auth（GoTrue）を呼び出す。
 */
export const supabaseAuthService = {
  /**
   * サインアップ。Supabase Auth にユーザーを登録する。
   * メール確認が無効なため、登録と同時にセッション（トークン）が発行される。
   */
  signup: async (input: SignupInput): Promise<AuthResult> => {
    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
    })
    if (error) {
      throw new AppError(400, error.message)
    }
    return { token: data.session?.access_token ?? null, user: data.user }
  },

  /**
   * ログイン。Supabase Auth で認証し、アクセストークンを取得する。
   */
  login: async (input: LoginInput): Promise<AuthResult> => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    })
    if (error) {
      throw new AppError(401, 'メールアドレスまたはパスワードが正しくありません')
    }
    return { token: data.session.access_token, user: data.user }
  },
}
