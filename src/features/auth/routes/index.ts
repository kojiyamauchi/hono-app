import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'

import { authMiddleware } from '@/middlewares/auth'
import { originMiddleware } from '@/middlewares/origin'
import { onValidationError } from '@/utils/validation'

import { authController } from '../controllers'
import { changePasswordSchema, confirmPasswordResetSchema, loginSchema, requestPasswordResetSchema, signupSchema } from '../schemas'

/**
 * 認証関連のルート（/auth配下）。
 * signup/login/refresh/logoutにはCookieを利用・更新するためOrigin検証を適用する。
 * password-reset/*はCookie/ambient credentialを使用しないためoriginMiddlewareは適用しない。
 */
export const authRoutes = new Hono()
  .post('/signup', originMiddleware, zValidator('json', signupSchema, onValidationError), (c) => authController.signup(c, c.req.valid('json')))
  .post('/login', originMiddleware, zValidator('json', loginSchema, onValidationError), (c) => authController.login(c, c.req.valid('json')))
  .post('/refresh', originMiddleware, (c) => authController.refresh(c))
  .post('/logout', originMiddleware, (c) => authController.logout(c))
  .get('/me', authMiddleware, (c) => authController.me(c, c.get('userId')))
  .post('/change-password', originMiddleware, authMiddleware, zValidator('json', changePasswordSchema, onValidationError), (c) =>
    authController.changePassword(c, c.get('userId'), c.req.valid('json')),
  )
  .post('/password-reset/request', zValidator('json', requestPasswordResetSchema, onValidationError), (c) =>
    authController.requestPasswordReset(c, c.req.valid('json')),
  )
  .post('/password-reset/confirm', zValidator('json', confirmPasswordResetSchema, onValidationError), (c) =>
    authController.confirmPasswordReset(c, c.req.valid('json')),
  )
  .post('/logout-all', originMiddleware, authMiddleware, (c) => authController.logoutAll(c, c.get('userId')))
  .get('/sessions', authMiddleware, (c) => authController.listSessions(c, c.get('userId')))
