import { describe, expect, test } from 'bun:test'

import type { Organization } from '@/shared/organization/entities'

import { listDto as organizationListDto } from '../dtos'
import { toListResponse } from '.'

describe('toListResponse', () => {
  const organization: Organization = {
    id: 1,
    name: 'Acme',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  }

  test('組織とページ情報をレスポンス用に変換し、organizationListDto schemaに通る', () => {
    const result = toListResponse([organization], 20, 40, true)

    expect(result.items).toHaveLength(1)
    expect(result).toMatchObject({ limit: 20, offset: 40, hasNext: true })
    expect(organizationListDto.safeParse(result).success).toBe(true)
  })
})
