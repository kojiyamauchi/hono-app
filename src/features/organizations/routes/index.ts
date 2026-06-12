import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'

import { authMiddleware } from '@/middlewares/auth'
import { organizationMembershipMiddleware } from '@/middlewares/organizationMembership'
import { onValidationError } from '@/utils/validation'

import { organizationsController, organizationsInvitationsController, organizationsMembersController } from '../controllers'
import {
  addMemberBodySchema,
  createInvitationBodySchema,
  createOrganizationSchema,
  invitationRouteParamSchema,
  memberRouteParamSchema,
  organizationIdParamSchema,
  updateMemberRoleBodySchema,
  updateOrganizationSchema,
} from '../schemas'

/**
 * 組織関連のルート（/organizations配下）。
 * すべて認証が必要。`/:id` 系は組織メンバーシップの確認も行う。
 */
export const organizationsRoutes = new Hono()
  .post('/', authMiddleware, zValidator('json', createOrganizationSchema, onValidationError), (c) =>
    organizationsController.create(c, c.get('userId'), c.req.valid('json')),
  )
  .get('/', authMiddleware, (c) => organizationsController.listMine(c, c.get('userId')))
  .get('/:id', authMiddleware, zValidator('param', organizationIdParamSchema, onValidationError), organizationMembershipMiddleware, (c) =>
    organizationsController.getById(c, c.req.valid('param').id),
  )
  .patch(
    '/:id',
    authMiddleware,
    zValidator('param', organizationIdParamSchema, onValidationError),
    organizationMembershipMiddleware,
    zValidator('json', updateOrganizationSchema, onValidationError),
    (c) => organizationsController.update(c, c.req.valid('param').id, c.req.valid('json'), c.get('membership').role),
  )
  .delete('/:id', authMiddleware, zValidator('param', organizationIdParamSchema, onValidationError), organizationMembershipMiddleware, (c) =>
    organizationsController.remove(c, c.req.valid('param').id, c.get('membership').role),
  )
  .get('/:id/members', authMiddleware, zValidator('param', organizationIdParamSchema, onValidationError), organizationMembershipMiddleware, (c) =>
    organizationsMembersController.listMembers(c, c.req.valid('param').id),
  )
  .post(
    '/:id/members',
    authMiddleware,
    zValidator('param', organizationIdParamSchema, onValidationError),
    organizationMembershipMiddleware,
    zValidator('json', addMemberBodySchema, onValidationError),
    (c) => organizationsMembersController.addMember(c, c.req.valid('param').id, c.get('membership').role, c.req.valid('json')),
  )
  .patch(
    '/:id/members/:membershipId',
    authMiddleware,
    zValidator('param', memberRouteParamSchema, onValidationError),
    organizationMembershipMiddleware,
    zValidator('json', updateMemberRoleBodySchema, onValidationError),
    (c) =>
      organizationsMembersController.updateMemberRole(
        c,
        c.req.valid('param').id,
        c.req.valid('param').membershipId,
        c.get('membership').role,
        c.req.valid('json'),
      ),
  )
  .delete('/:id/members/:membershipId', authMiddleware, zValidator('param', memberRouteParamSchema, onValidationError), organizationMembershipMiddleware, (c) =>
    organizationsMembersController.removeMember(c, c.req.valid('param').id, c.req.valid('param').membershipId, c.get('membership').role),
  )
  .get('/:id/invitations', authMiddleware, zValidator('param', organizationIdParamSchema, onValidationError), organizationMembershipMiddleware, (c) =>
    organizationsInvitationsController.listInvitations(c, c.req.valid('param').id, c.get('membership').role),
  )
  .post(
    '/:id/invitations',
    authMiddleware,
    zValidator('param', organizationIdParamSchema, onValidationError),
    organizationMembershipMiddleware,
    zValidator('json', createInvitationBodySchema, onValidationError),
    (c) => organizationsInvitationsController.createInvitation(c, c.req.valid('param').id, c.get('membership').role, c.req.valid('json')),
  )
  .delete(
    '/:id/invitations/:invitationId',
    authMiddleware,
    zValidator('param', invitationRouteParamSchema, onValidationError),
    organizationMembershipMiddleware,
    (c) => organizationsInvitationsController.cancelInvitation(c, c.req.valid('param').id, c.req.valid('param').invitationId, c.get('membership').role),
  )
