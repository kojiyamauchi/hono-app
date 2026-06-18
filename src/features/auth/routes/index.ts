import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'

import { authMiddleware } from '@/middlewares/auth'
import { onValidationError } from '@/utils/validation'

import { authController } from '../controllers'
import { loginSchema, refreshTokenBodySchema, signupSchema } from '../schemas'

/**
 * 認証関連のルート（/auth配下）。
 */
export const authRoutes = new Hono()
  .post('/signup', zValidator('json', signupSchema, onValidationError), (c) => authController.signup(c, c.req.valid('json')))
  .post('/login', zValidator('json', loginSchema, onValidationError), (c) => authController.login(c, c.req.valid('json')))
  .post('/refresh', zValidator('json', refreshTokenBodySchema, onValidationError), (c) => authController.refresh(c, c.req.valid('json')))
  .post('/logout', zValidator('json', refreshTokenBodySchema, onValidationError), (c) => authController.logout(c, c.req.valid('json')))
  .get('/me', authMiddleware, (c) => authController.me(c, c.get('userId')))
