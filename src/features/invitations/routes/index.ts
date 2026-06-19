import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'

import { authMiddleware } from '@/middlewares/auth'
import { originMiddleware } from '@/middlewares/origin'
import { onValidationError } from '@/utils/validation'

import { invitationsController } from '../controllers'
import { acceptInvitationBodySchema, declineInvitationBodySchema, invitationTokenParamSchema, signupInvitationBodySchema } from '../schemas'

/**
 * 招待関連のルート（/invitations配下）。
 * GET /:token は認証不要（招待リンクのpreview用）。
 * accept は認証が必要。decline は認証不要（トークンのみで操作）。
 * signup はCookieを設定するためOrigin検証を適用する。
 */
export const invitationsRoutes = new Hono()
  .get('/:token', zValidator('param', invitationTokenParamSchema, onValidationError), (c) => invitationsController.getDetail(c, c.req.valid('param').token))
  .post('/accept', authMiddleware, zValidator('json', acceptInvitationBodySchema, onValidationError), (c) =>
    invitationsController.accept(c, c.get('userId'), c.req.valid('json')),
  )
  .post('/decline', zValidator('json', declineInvitationBodySchema, onValidationError), (c) => invitationsController.decline(c, c.req.valid('json')))
  .post('/signup', originMiddleware, zValidator('json', signupInvitationBodySchema, onValidationError), (c) =>
    invitationsController.signup(c, c.req.valid('json')),
  )
