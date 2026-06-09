import { describe, expect, test } from 'bun:test'

import type { Organization } from '@/shared/organization/entities'

import { toOrganizationResponse } from '.'

const organization: Organization = {
  id: 1,
  name: 'Acme',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
}

describe('toOrganizationResponse', () => {
  test('組織情報をレスポンス用に変換する', () => {
    const result = toOrganizationResponse(organization)

    expect(result).toEqual({
      id: 1,
      name: 'Acme',
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
    })
  })
})
