import { supabase } from '@/libs/supabase'
import { resolveExternalApiErrorType, resolveExternalApiHost, resolveExternalApiStatusCode, traceExternalApiCall } from '@/libs/telemetry/external'
import { AppError } from '@/utils/errors'
import { getEnvironment } from '@/utils/runtime'

import type { BodySchemaType } from '../schemas/login'
import type { AuthResult } from './common'

/**
 * Supabase Auth を利用したログインのロジック（BFFパターン）。
 * Hono が内部で Supabase Auth（GoTrue）を呼び出す。
 */
export const loginService = {
  /**
   * ログイン。Supabase Auth で認証し、アクセストークンを取得する。
   */
  execute: async (input: BodySchemaType): Promise<AuthResult> => {
    const { data, error } = await traceExternalApiCall(
      {
        host: resolveExternalApiHost(getEnvironment().SUPABASE_URL),
        method: 'POST',
        operation: 'auth.signInWithPassword',
        resolveResult: (result: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>) => ({
          errorType: resolveExternalApiErrorType(result.error),
          statusCode: resolveExternalApiStatusCode(result.error),
          success: !result.error,
        }),
        system: 'supabase',
      },
      () =>
        supabase.auth.signInWithPassword({
          email: input.email,
          password: input.password,
        }),
    )
    if (error) {
      throw new AppError(401, 'メールアドレスまたはパスワードが正しくありません')
    }
    return { token: data.session.access_token, user: data.user }
  },
}
