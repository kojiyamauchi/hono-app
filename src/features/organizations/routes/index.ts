import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'

import { authMiddleware } from '@/middlewares/auth'
import { organizationMembershipMiddleware } from '@/middlewares/organizationMembership'
import { onBodyValidationError, onValidationError } from '@/utils/validation'

import { organizationsController, organizationsMembersController } from '../controllers'
import {
  addMemberBodySchema,
  createOrganizationSchema,
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
    zValidator('json', addMemberBodySchema, onBodyValidationError),
    (c) => organizationsMembersController.addMember(c, c.req.valid('param').id, c.get('membership').role, c.req.valid('json')),
  )
  .patch(
    '/:id/members/:membershipId',
    authMiddleware,
    zValidator('param', memberRouteParamSchema, onValidationError),
    organizationMembershipMiddleware,
    zValidator('json', updateMemberRoleBodySchema, onBodyValidationError),
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
