import { beforeEach, describe, expect, mock, test } from 'bun:test'

// JWT発行に必要なシークレットをテスト用に設定
process.env.JWT_SECRET = 'test-secret'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret'
process.env.PASSWORD_RESET_TOKEN_SECRET = 'test-password-reset-secret'
process.env.EMAIL_VERIFICATION_TOKEN_SECRET = 'test-email-verification-secret'

const createRefreshToken = mock()
const findByTokenHash = mock()
const revokeById = mock()
const revokeFamily = mock()
const rotate = mock()
const revokeAllByUserId = mock()
const revokeByUserIdAndFamilyId = mock()
const changePassword = mock()
const findActiveSessionsByUserId = mock()

const prtCreate = mock()
const prtFindByTokenHash = mock()
const prtDeleteByIdAndTokenHash = mock()
const prtConfirm = mock()
const evtFindByTokenHash = mock()
const evtConfirm = mock()

await mock.module('@/shared/auth/repositories/credential', () => ({
  authCredentialRepository: {
    changePassword,
  },
}))

await mock.module('@/shared/auth/repositories/refreshToken', () => ({
  refreshTokenRepository: {
    create: createRefreshToken,
    findByTokenHash,
    revokeById,
    revokeFamily,
    rotate,
    revokeAllByUserId,
    revokeByUserIdAndFamilyId,
    findActiveSessionsByUserId,
  },
}))

await mock.module('@/shared/auth/repositories/passwordReset', () => ({
  passwordResetTokenRepository: {
    create: prtCreate,
    findByTokenHash: prtFindByTokenHash,
    deleteByIdAndTokenHash: prtDeleteByIdAndTokenHash,
    confirm: prtConfirm,
  },
}))

await mock.module('@/shared/auth/repositories/emailVerification', () => ({
  emailVerificationTokenRepository: {
    findByTokenHash: evtFindByTokenHash,
    confirm: evtConfirm,
  },
}))

// notifierをモックしてno-op実装を差し替える
const notifierSend = mock()
const sendEmailVerificationBestEffort = mock()

// shared/auth/servicesの実装関数はそのまま使い、passwordResetNotifierのみ差し替える
const authServicesModule = await import('@/shared/auth/services')
await mock.module('@/shared/auth/services', () => ({
  ...authServicesModule,
  passwordResetNotifier: { send: notifierSend },
  sendEmailVerificationBestEffort,
}))

const passwordResetRequestDelayMs = mock(() => 0)
await mock.module('@/utils/timing', () => ({
  passwordResetRequestDelayMs,
}))

// userRepositoryをモックし、DBに依存せずserviceのロジックを検証する
const findByEmail = mock()
const create = mock()
const findById = mock()

await mock.module('@/shared/user/repositories', () => ({
  userRepository: { findByEmail, create, findById },
}))

const { sessionsService } = await import('./sessions')

beforeEach(() => {
  createRefreshToken.mockReset()
  findByTokenHash.mockReset()
  revokeById.mockReset()
  revokeFamily.mockReset()
  rotate.mockReset()
  revokeAllByUserId.mockReset()
  revokeByUserIdAndFamilyId.mockReset()
  changePassword.mockReset()
  findActiveSessionsByUserId.mockReset()
  findById.mockReset()
  prtCreate.mockReset()
  prtFindByTokenHash.mockReset()
  prtDeleteByIdAndTokenHash.mockReset()
  prtConfirm.mockReset()
  evtFindByTokenHash.mockReset()
  evtConfirm.mockReset()
  notifierSend.mockReset()
  sendEmailVerificationBestEffort.mockReset()
  passwordResetRequestDelayMs.mockReset()
  passwordResetRequestDelayMs.mockImplementation(() => 0)
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
