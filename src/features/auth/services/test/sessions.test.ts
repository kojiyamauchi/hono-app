import { beforeEach, describe, expect, test } from 'bun:test'

import { createRefreshTokenRepositoryMock, installRefreshTokenRepositoryMock } from './testSupport'

const refreshTokens = createRefreshTokenRepositoryMock()
await installRefreshTokenRepositoryMock(refreshTokens.mocks)
const { findActiveSessionsByUserId, revokeByUserIdAndFamilyId } = refreshTokens.mocks

const { sessionsService } = await import('../sessions')

beforeEach(() => {
  refreshTokens.reset()
})

describe('sessionsService.revoke', () => {
  test('指定ユーザーのセッションIDで失効処理を呼び出す', async () => {
    revokeByUserIdAndFamilyId.mockResolvedValue(1)

    await expect(sessionsService.revoke(1, '550e8400-e29b-41d4-a716-446655440000')).resolves.toBeUndefined()

    expect(revokeByUserIdAndFamilyId).toHaveBeenCalledWith(1, '550e8400-e29b-41d4-a716-446655440000')
  })

  test('存在しない・他ユーザー・失効済みのセッションは404へ畳み込む', async () => {
    revokeByUserIdAndFamilyId.mockResolvedValue(0)

    await expect(sessionsService.revoke(1, '550e8400-e29b-41d4-a716-446655440000')).rejects.toMatchObject({
      statusCode: 404,
    })
  })
})

describe('sessionsService.list', () => {
  const createdAt = new Date('2026-06-01T00:00:00.000Z')
  const expiresAt = new Date('2026-07-01T00:00:00.000Z')
  const lastUsedAt = new Date('2026-06-20T00:00:00.000Z')

  test('repositoryから取得したRefreshSession配列をDTOへ変換して返すこと（id=familyId）', async () => {
    findActiveSessionsByUserId.mockResolvedValue([{ familyId: 'family-uuid-1', createdAt, expiresAt, lastUsedAt }])

    const sessions = await sessionsService.list(1)

    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe('family-uuid-1')
    expect(sessions[0].createdAt).toBe(createdAt.toISOString())
    expect(sessions[0].expiresAt).toBe(expiresAt.toISOString())
    expect(sessions[0].lastUsedAt).toBe(lastUsedAt.toISOString())
  })

  test('レスポンスにtokenHash等の内部値を含まないこと（各要素のキーがid/createdAt/expiresAt/lastUsedAtのみ）', async () => {
    findActiveSessionsByUserId.mockResolvedValue([{ familyId: 'family-uuid-1', createdAt, expiresAt, lastUsedAt }])

    const sessions = await sessionsService.list(1)

    expect(sessions[0]).not.toHaveProperty('tokenHash')
    expect(sessions[0]).not.toHaveProperty('familyId')
    expect(sessions[0]).not.toHaveProperty('revokedAt')
    const keys = Object.keys(sessions[0])
    expect(keys).toHaveLength(4)
    expect(keys).toContain('id')
    expect(keys).toContain('createdAt')
    expect(keys).toContain('expiresAt')
    expect(keys).toContain('lastUsedAt')
  })

  test('repositoryが空配列なら空配列を返すこと', async () => {
    findActiveSessionsByUserId.mockResolvedValue([])

    const sessions = await sessionsService.list(1)

    expect(sessions).toEqual([])
  })

  test('findActiveSessionsByUserId が渡したuserIdでcallされること', async () => {
    findActiveSessionsByUserId.mockResolvedValue([])

    await sessionsService.list(42)

    expect(findActiveSessionsByUserId).toHaveBeenCalledWith(42)
  })
})
