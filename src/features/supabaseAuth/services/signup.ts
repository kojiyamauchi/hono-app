import { supabase } from '@/libs/supabase'
import { resolveExternalApiErrorType, resolveExternalApiHost, resolveExternalApiStatusCode, traceExternalApiCall } from '@/libs/telemetry/external'
import { AppError } from '@/utils/errors'

import type { BodySchemaType } from '../schemas/signup'
import type { AuthResult } from './common'

/**
 * Supabase Auth を利用したサインアップのロジック（BFFパターン）。
 * Hono が内部で Supabase Auth（GoTrue）を呼び出す。
 */
export const signupService = {
  /**
   * サインアップ。Supabase Auth にユーザーを登録する。
   * メール確認が有効な場合は、確認完了までセッション（トークン）は発行されない。
   */
  execute: async (input: BodySchemaType): Promise<AuthResult> => {
    const { data, error } = await traceExternalApiCall(
      {
        host: resolveExternalApiHost(process.env.SUPABASE_URL),
        method: 'POST',
        operation: 'auth.signUp',
        resolveResult: (result: Awaited<ReturnType<typeof supabase.auth.signUp>>) => ({
          errorType: resolveExternalApiErrorType(result.error),
          statusCode: resolveExternalApiStatusCode(result.error),
          success: !result.error,
        }),
        system: 'supabase',
      },
      () =>
        supabase.auth.signUp({
          email: input.email,
          password: input.password,
        }),
    )
    if (error) {
      throw new AppError(400, error.message)
    }
    return { token: data.session?.access_token ?? null, user: data.user }
  },
}
