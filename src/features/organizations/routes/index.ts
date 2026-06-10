import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'

import { authMiddleware } from '@/middlewares/auth'
import { organizationMembershipMiddleware } from '@/middlewares/organizationMembership'
import { onValidationError } from '@/utils/validation'

import { organizationsController } from '../controllers'
import { createOrganizationSchema, organizationIdParamSchema, updateOrganizationSchema } from '../schemas'

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
