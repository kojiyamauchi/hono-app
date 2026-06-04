import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'

import { supabaseAuthMiddleware } from '@/middlewares/supabaseAuth'
import { onValidationError } from '@/utils/validation'

import { supabaseAuthController } from '../controllers'
import { loginSchema, signupSchema } from '../schemas'

/**
 * Supabase Auth 関連のルート（/supabase-auth配下）。
 */
export const supabaseAuthRoutes = new Hono()
  .post('/signup', zValidator('json', signupSchema, onValidationError), (c) => supabaseAuthController.signup(c, c.req.valid('json')))
  .post('/login', zValidator('json', loginSchema, onValidationError), (c) => supabaseAuthController.login(c, c.req.valid('json')))
  .get('/me', supabaseAuthMiddleware, (c) => supabaseAuthController.me(c, c.get('supabaseUser')))
