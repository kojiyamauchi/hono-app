import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'

import { authMiddleware } from '@/middlewares/auth'
import { onValidationError } from '@/utils/validation'

import { usersController } from '../controllers'
import { updateMeSchema, userIdParamSchema } from '../schemas'

/**
 * ユーザー関連のルート（/users配下）。
 */
export const usersRoutes = new Hono()
  .get('/me', authMiddleware, (c) => usersController.me(c, c.get('userId')))
  .patch('/me', authMiddleware, zValidator('json', updateMeSchema, onValidationError), (c) => usersController.updateMe(c, c.get('userId'), c.req.valid('json')))
  .get('/:id', authMiddleware, zValidator('param', userIdParamSchema, onValidationError), (c) => usersController.getById(c, c.req.valid('param').id))
