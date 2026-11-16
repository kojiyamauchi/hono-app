import { OpenAPIHono } from '@hono/zod-openapi'

import { openApiDefaultHook } from '@/utils/validation'

import { changePasswordRoutes } from './changePassword'
import { emailVerificationRoutes } from './emailVerification'
import { loginRoutes } from './login'
import { logoutRoutes } from './logout'
import { logoutAllRoutes } from './logoutAll'
import { meRoutes } from './me'
import { passwordResetRoutes } from './passwordReset'
import { refreshRoutes } from './refresh'
import { sessionsRoutes } from './sessions'
import { signupRoutes } from './signup'

/**
 * 認証関連のルート（/auth配下）。
 * signup/login/refresh/logoutにはCookieを利用・更新するためOrigin検証を適用する。
 * password-reset/*とemail-verification/confirmはCookie/ambient credentialを使用しないためoriginMiddlewareは適用しない。
 * email-verification/requestは認証済みの状態変更endpointとしてoriginMiddlewareを適用する。
 * バリデーションエラー時は defaultHook で既存と同じ `{ error: { message } }`（400）を返す。
 * `/sessions` を `/sessions/{id}` より先に登録し、静的パスを優先する。
 */
export const authRoutes = new OpenAPIHono({ defaultHook: openApiDefaultHook })
  .route('/', signupRoutes)
  .route('/', loginRoutes)
  .route('/', refreshRoutes)
  .route('/', logoutRoutes)
  .route('/', meRoutes)
  .route('/', changePasswordRoutes)
  .route('/', passwordResetRoutes)
  .route('/', emailVerificationRoutes)
  .route('/', logoutAllRoutes)
  .route('/', sessionsRoutes)
