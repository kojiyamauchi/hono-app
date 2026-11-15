import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'

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

const { signupService, signupRateLimiter, SIGNUP_IP_RATE_LIMIT } = await import('./signup')

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
  signupRateLimiter.reset()
})

describe('signupService.execute', () => {
  beforeEach(() => {
    findByEmail.mockReset()
    create.mockReset()
  })

  test('新規メールなら登録し、トークンとパスワードを除いたユーザーを返す', async () => {
    findByEmail.mockResolvedValue(null)
    create.mockImplementation(async (input: { name: string; email: string; password: string }) => ({
      id: 1,
      name: input.name,
      email: input.email,
      password: input.password,
      emailVerifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))

    const result = await signupService.execute({
      name: 'Taro',
      email: 'taro@example.com',
      password: 'password123',
    })

    expect(typeof result.token).toBe('string')
    expect(typeof result.refreshToken).toBe('string')
    expect(result.user.email).toBe('taro@example.com')
    expect(result.user.emailVerified).toBe(false)
    expect(result.user).not.toHaveProperty('password')
    expect(createRefreshToken).toHaveBeenCalledTimes(1)
    expect(sendEmailVerificationBestEffort).toHaveBeenCalledWith(1, 'taro@example.com')

    // パスワードはハッシュ化されて保存される（平文のままでない）
    const createdInput = create.mock.calls[0][0] as { password: string }
    expect(createdInput.password).not.toBe('password123')
  })

  test('既存メールなら409エラーを投げる', async () => {
    findByEmail.mockResolvedValue({
      id: 1,
      name: 'Existing',
      email: 'taro@example.com',
      password: 'hashed',
      emailVerifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await expect(signupService.execute({ name: 'Taro', email: 'taro@example.com', password: 'password123' })).rejects.toThrow('既に登録')
  })

  test('findByEmailをすり抜けたcreateの一意制約違反（null）は409へ変換する', async () => {
    // findByEmailは未登録を返すが、同時signupの競合でcreateがP2002によりnullを返すケース
    findByEmail.mockResolvedValue(null)
    create.mockResolvedValue(null)

    await expect(signupService.execute({ name: 'Taro', email: 'taro@example.com', password: 'password123' })).rejects.toMatchObject({
      statusCode: 409,
    })
    // 認証トークンは発行されない
    expect(createRefreshToken).not.toHaveBeenCalled()
  })

  test('同一IPからSIGNUP_IP_RATE_LIMIT回の後、次の試行は429エラーを投げる', async () => {
    findByEmail.mockResolvedValue(null)
    create.mockImplementation(async (input: { name: string; email: string; password: string }) => ({
      id: 1,
      name: input.name,
      email: input.email,
      password: input.password,
      emailVerifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
    const infoSpy = spyOn(console, 'info').mockImplementation(() => {})

    try {
      for (let i = 0; i < SIGNUP_IP_RATE_LIMIT; i++) {
        await expect(signupService.execute({ name: 'Taro', email: `user-${i}@example.com`, password: 'password123' }, '203.0.113.20')).resolves.toBeDefined()
      }

      await expect(signupService.execute({ name: 'Taro', email: 'user-overflow@example.com', password: 'password123' }, '203.0.113.20')).rejects.toMatchObject({
        statusCode: 429,
      })
    } finally {
      infoSpy.mockRestore()
    }
  })

  test('clientIp未指定の場合はIP単位の制限がかからない', async () => {
    findByEmail.mockResolvedValue(null)
    create.mockImplementation(async (input: { name: string; email: string; password: string }) => ({
      id: 1,
      name: input.name,
      email: input.email,
      password: input.password,
      emailVerifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))

    for (let i = 0; i < SIGNUP_IP_RATE_LIMIT + 1; i++) {
      await expect(signupService.execute({ name: 'Taro', email: `user-${i}@example.com`, password: 'password123' })).resolves.toBeDefined()
    }
  })
})
