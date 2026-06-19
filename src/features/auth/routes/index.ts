import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'

import { authMiddleware } from '@/middlewares/auth'
import { originMiddleware } from '@/middlewares/origin'
import { onValidationError } from '@/utils/validation'

import { authController } from '../controllers'
import { loginSchema, signupSchema } from '../schemas'

/**
 * 認証関連のルート（/auth配下）。
 * signup/login/refresh/logoutにはCookieを利用・更新するためOrigin検証を適用する。
 */
export const authRoutes = new Hono()
  .post('/signup', originMiddleware, zValidator('json', signupSchema, onValidationError), (c) => authController.signup(c, c.req.valid('json')))
  .post('/login', originMiddleware, zValidator('json', loginSchema, onValidationError), (c) => authController.login(c, c.req.valid('json')))
  .post('/refresh', originMiddleware, (c) => authController.refresh(c))
  .post('/logout', originMiddleware, (c) => authController.logout(c))
  .get('/me', authMiddleware, (c) => authController.me(c, c.get('userId')))
