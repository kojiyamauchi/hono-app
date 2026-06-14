import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'

import { authMiddleware } from '@/middlewares/auth'
import { onValidationError } from '@/utils/validation'

import { invitationsController } from '../controllers'
import { acceptInvitationBodySchema } from '../schemas'

/**
 * 招待関連のルート（/invitations配下）。
 * すべて認証が必要。
 */
export const invitationsRoutes = new Hono().post('/accept', authMiddleware, zValidator('json', acceptInvitationBodySchema, onValidationError), (c) =>
  invitationsController.accept(c, c.get('userId'), c.req.valid('json')),
)
