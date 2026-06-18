import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'

import { authMiddleware } from '@/middlewares/auth'
import { onValidationError } from '@/utils/validation'

import { invitationsController } from '../controllers'
import { acceptInvitationBodySchema, declineInvitationBodySchema, invitationTokenParamSchema, signupInvitationBodySchema } from '../schemas'

/**
 * 招待関連のルート（/invitations配下）。
 * GET /:token は認証不要（招待リンクのpreview用）。
 * accept は認証が必要。decline/signup は認証不要（トークンのみで操作）。
 */
export const invitationsRoutes = new Hono()
  .get('/:token', zValidator('param', invitationTokenParamSchema, onValidationError), (c) => invitationsController.getDetail(c, c.req.valid('param').token))
  .post('/accept', authMiddleware, zValidator('json', acceptInvitationBodySchema, onValidationError), (c) =>
    invitationsController.accept(c, c.get('userId'), c.req.valid('json')),
  )
  .post('/decline', zValidator('json', declineInvitationBodySchema, onValidationError), (c) => invitationsController.decline(c, c.req.valid('json')))
  .post('/signup', zValidator('json', signupInvitationBodySchema, onValidationError), (c) => invitationsController.signup(c, c.req.valid('json')))
