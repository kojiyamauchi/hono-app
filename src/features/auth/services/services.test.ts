import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'

import type { PasswordResetToken, RefreshToken } from '@/shared/auth/entities'
import type { User } from '@/shared/user/entities'

// JWT発行に必要なシークレットをテスト用に設定
process.env.JWT_SECRET = 'test-secret'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret'
process.env.PASSWORD_RESET_TOKEN_SECRET = 'test-password-reset-secret'

const createRefreshToken = mock()
const findByTokenHash = mock()
const revokeById = mock()
const revokeFamily = mock()
const rotate = mock()
const revokeAllByUserId = mock()
const changePassword = mock()
const findActiveSessionsByUserId = mock()

const prtCreate = mock()
const prtFindByTokenHash = mock()
const prtDeleteByIdAndTokenHash = mock()
const prtConfirm = mock()

await mock.module('@/shared/auth/repositories', () => ({
  authCredentialRepository: {
    changePassword,
  },
  refreshTokenRepository: {
    create: createRefreshToken,
    findByTokenHash,
    revokeById,
    revokeFamily,
    rotate,
    revokeAllByUserId,
    findActiveSessionsByUserId,
  },
  passwordResetTokenRepository: {
    create: prtCreate,
    findByTokenHash: prtFindByTokenHash,
    deleteByIdAndTokenHash: prtDeleteByIdAndTokenHash,
    confirm: prtConfirm,
  },
}))

// notifierをモックしてno-op実装を差し替える
const notifierSend = mock()

// shared/auth/servicesの実装関数はそのまま使い、passwordResetNotifierのみ差し替える
const authServicesModule = await import('@/shared/auth/services')
await mock.module('@/shared/auth/services', () => ({
  ...authServicesModule,
  passwordResetNotifier: { send: notifierSend },
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

const { authService, passwordResetRequestRateLimiter } = await import('.')

const user: User = {
  id: 1,
  name: 'Taro',
  email: 'taro@example.com',
  password: 'hashed',
  createdAt: new Date('2026-06-18T00:00:00.000Z'),
  updatedAt: new Date('2026-06-18T00:00:00.000Z'),
}

const refreshToken: RefreshToken = {
  id: 10,
  userId: 1,
  familyId: 'family-id',
  tokenHash: 'token-hash',
  expiresAt: new Date(Date.now() + 60_000),
  revokedAt: null,
  createdAt: new Date('2026-06-18T00:00:00.000Z'),
}

const savedPasswordResetToken: PasswordResetToken = {
  id: 20,
  userId: 1,
  tokenHash: 'hashed-reset-token',
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  usedAt: null,
  createdAt: new Date('2026-06-18T00:00:00.000Z'),
}

beforeEach(() => {
  createRefreshToken.mockReset()
  findByTokenHash.mockReset()
  revokeById.mockReset()
  revokeFamily.mockReset()
  rotate.mockReset()
  revokeAllByUserId.mockReset()
  changePassword.mockReset()
  findActiveSessionsByUserId.mockReset()
  findById.mockReset()
  prtCreate.mockReset()
  prtFindByTokenHash.mockReset()
  prtDeleteByIdAndTokenHash.mockReset()
  prtConfirm.mockReset()
  notifierSend.mockReset()
  passwordResetRequestDelayMs.mockReset()
  passwordResetRequestDelayMs.mockImplementation(() => 0)
  passwordResetRequestRateLimiter.reset()
})

describe('authService.signup', () => {
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
      createdAt: new Date(),
      updatedAt: new Date(),
    }))

    const result = await authService.signup({
      name: 'Taro',
      email: 'taro@example.com',
      password: 'password123',
    })

    expect(typeof result.token).toBe('string')
    expect(typeof result.refreshToken).toBe('string')
    expect(result.user.email).toBe('taro@example.com')
    expect(result.user).not.toHaveProperty('password')
    expect(createRefreshToken).toHaveBeenCalledTimes(1)

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
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await expect(authService.signup({ name: 'Taro', email: 'taro@example.com', password: 'password123' })).rejects.toThrow('既に登録')
  })
})

describe('authService.login', () => {
  beforeEach(() => {
    findByEmail.mockReset()
  })

  test('正しいパスワードならトークンを返す', async () => {
    const hashed = await Bun.password.hash('password123')
    findByEmail.mockResolvedValue({
      id: 1,
      name: 'Taro',
      email: 'taro@example.com',
      password: hashed,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const result = await authService.login({ email: 'taro@example.com', password: 'password123' })

    expect(typeof result.token).toBe('string')
    expect(typeof result.refreshToken).toBe('string')
    expect(result.user.email).toBe('taro@example.com')
    expect(createRefreshToken).toHaveBeenCalledTimes(1)
  })

  test('誤ったパスワードなら401エラーを投げる', async () => {
    const hashed = await Bun.password.hash('password123')
    findByEmail.mockResolvedValue({
      id: 1,
      name: 'Taro',
      email: 'taro@example.com',
      password: hashed,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await expect(authService.login({ email: 'taro@example.com', password: 'wrong-password' })).rejects.toThrow('正しくありません')
  })

  test('ユーザーが存在しないなら401エラーを投げる', async () => {
    findByEmail.mockResolvedValue(null)

    await expect(authService.login({ email: 'none@example.com', password: 'password123' })).rejects.toThrow('正しくありません')
  })
})

describe('authService.refresh', () => {
  beforeEach(() => {
    findByTokenHash.mockResolvedValue(refreshToken)
    findById.mockResolvedValue(user)
    rotate.mockResolvedValue({ status: 'ROTATED', refreshToken: { ...refreshToken, id: 11 } })
  })

  test('有効なトークンをローテーションして新しい認証結果を返す', async () => {
    const result = await authService.refresh('plain-refresh-token')

    expect(typeof result.token).toBe('string')
    expect(typeof result.refreshToken).toBe('string')
    expect(result.refreshToken).not.toBe('plain-refresh-token')
    expect(result.user.id).toBe(1)
    expect(rotate).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ userId: 1, familyId: 'family-id', tokenHash: expect.any(String), expiresAt: expect.any(Date) }),
    )
  })

  test('存在しないトークンは401エラーを投げる', async () => {
    findByTokenHash.mockResolvedValue(null)

    await expect(authService.refresh('unknown-token')).rejects.toThrow('リフレッシュトークンが無効です')
    expect(rotate).not.toHaveBeenCalled()
  })

  test('失効済みトークンの再提示はfamilyを失効して401エラーを投げる', async () => {
    findByTokenHash.mockResolvedValue({ ...refreshToken, revokedAt: new Date() })

    await expect(authService.refresh('revoked-token')).rejects.toThrow('リフレッシュトークンが無効です')
    expect(revokeFamily).toHaveBeenCalledWith('family-id')
    expect(findById).not.toHaveBeenCalled()
  })

  test('期限切れトークンは当該トークンを失効して401エラーを投げる', async () => {
    findByTokenHash.mockResolvedValue({ ...refreshToken, expiresAt: new Date(Date.now() - 1) })

    await expect(authService.refresh('expired-token')).rejects.toThrow('リフレッシュトークンが無効です')
    expect(revokeById).toHaveBeenCalledWith(10)
    expect(rotate).not.toHaveBeenCalled()
  })

  test('ユーザーが存在しない場合はfamilyを失効して401エラーを投げる', async () => {
    findById.mockResolvedValue(null)

    await expect(authService.refresh('orphan-token')).rejects.toThrow('リフレッシュトークンが無効です')
    expect(revokeFamily).toHaveBeenCalledWith('family-id')
    expect(rotate).not.toHaveBeenCalled()
  })

  test('条件付き失効が競合した場合はcommit後の再利用結果を401へ変換する', async () => {
    rotate.mockResolvedValue({ status: 'REUSED' })

    await expect(authService.refresh('reused-token')).rejects.toThrow('リフレッシュトークンが無効です')
  })

  test('アクセストークンを発行できない場合はローテーションしない', async () => {
    const jwtSecret = process.env.JWT_SECRET
    delete process.env.JWT_SECRET

    try {
      await expect(authService.refresh('plain-refresh-token')).rejects.toThrow('JWT_SECRETが設定されていません')
      expect(rotate).not.toHaveBeenCalled()
    } finally {
      process.env.JWT_SECRET = jwtSecret
    }
  })
})

describe('authService.logout', () => {
  test('トークンが存在する場合はfamilyを失効する', async () => {
    findByTokenHash.mockResolvedValue(refreshToken)

    await expect(authService.logout('plain-refresh-token')).resolves.toBeUndefined()
    expect(revokeFamily).toHaveBeenCalledWith('family-id')
  })

  test('トークンが存在しない場合も成功する', async () => {
    findByTokenHash.mockResolvedValue(null)

    await expect(authService.logout('unknown-token')).resolves.toBeUndefined()
    expect(revokeFamily).not.toHaveBeenCalled()
  })
})

describe('authService.changePassword', () => {
  test('現在のパスワードが正しい場合は新しいパスワードへ変更する', async () => {
    const hashed = await Bun.password.hash('current-password-123')
    findById.mockResolvedValue({ ...user, password: hashed })
    changePassword.mockResolvedValue(true)

    await expect(authService.changePassword(1, 'current-password-123', 'new-password-123')).resolves.toBeUndefined()

    expect(findById).toHaveBeenCalledWith(1)
    expect(changePassword).toHaveBeenCalledTimes(1)
    const [_userId, hashedPassword] = changePassword.mock.calls[0] as [number, string]
    expect(_userId).toBe(1)
    expect(hashedPassword).not.toBe('new-password-123')
    expect(hashedPassword.length).toBeGreaterThan(0)
  })

  test('現在のパスワードが誤っている場合は401エラーを投げる', async () => {
    const hashed = await Bun.password.hash('current-password-123')
    findById.mockResolvedValue({ ...user, password: hashed })

    await expect(authService.changePassword(1, 'wrong-password', 'new-password-123')).rejects.toMatchObject({
      statusCode: 401,
    })
    expect(changePassword).not.toHaveBeenCalled()
  })

  test('新しいパスワードが現在のパスワードと同じ場合は400エラーを投げる', async () => {
    const hashed = await Bun.password.hash('current-password-123')
    findById.mockResolvedValue({ ...user, password: hashed })

    await expect(authService.changePassword(1, 'current-password-123', 'current-password-123')).rejects.toMatchObject({
      statusCode: 400,
    })
    expect(changePassword).not.toHaveBeenCalled()
  })

  test('ユーザーが存在しない場合は404エラーを投げる', async () => {
    findById.mockResolvedValue(null)

    await expect(authService.changePassword(1, 'current-password-123', 'new-password-123')).rejects.toMatchObject({
      statusCode: 404,
    })
    expect(changePassword).not.toHaveBeenCalled()
  })

  test('永続化時に対象ユーザーが存在しなくなった場合は404エラーを投げる', async () => {
    const hashed = await Bun.password.hash('current-password-123')
    findById.mockResolvedValue({ ...user, password: hashed })
    changePassword.mockResolvedValue(false)

    await expect(authService.changePassword(1, 'current-password-123', 'new-password-123')).rejects.toMatchObject({
      statusCode: 404,
    })
  })
})

describe('authService.requestPasswordReset', () => {
  test('登録済みユーザーへトークンを発行し、notifierへ送信を依頼する', async () => {
    findByEmail.mockResolvedValue(user)
    prtCreate.mockResolvedValue(savedPasswordResetToken)
    notifierSend.mockResolvedValue(undefined)

    await expect(authService.requestPasswordReset('taro@example.com')).resolves.toBeUndefined()
    expect(prtCreate).toHaveBeenCalledTimes(1)
    expect(notifierSend).toHaveBeenCalledTimes(1)
  })

  test('未登録メールアドレスの場合は何もせず正常終了する（登録有無を外部に漏らさない）', async () => {
    findByEmail.mockResolvedValue(null)

    await expect(authService.requestPasswordReset('notregistered@example.com')).resolves.toBeUndefined()
    expect(prtCreate).not.toHaveBeenCalled()
    expect(notifierSend).not.toHaveBeenCalled()
  })

  test('DBへ平文トークンを保存しない（ハッシュ値を保存する）', async () => {
    findByEmail.mockResolvedValue(user)
    prtCreate.mockResolvedValue(savedPasswordResetToken)
    notifierSend.mockResolvedValue(undefined)

    await authService.requestPasswordReset('taro@example.com')

    const [_userId, tokenHash] = prtCreate.mock.calls[0] as [number, string, Date]
    // notifierへ渡すtokenはprtCreateへ渡すtokenHashと一致しない（ハッシュされている）
    const sentParams = notifierSend.mock.calls[0][0] as { token: string }
    expect(tokenHash).not.toBe(sentParams.token)
    // tokenHashは空文字でない
    expect(tokenHash.length).toBeGreaterThan(0)
  })

  test('通知失敗時はbest-effortで発行済みトークンを削除する', async () => {
    findByEmail.mockResolvedValue(user)
    prtCreate.mockResolvedValue(savedPasswordResetToken)
    notifierSend.mockRejectedValue(new Error('SMTP error'))
    prtDeleteByIdAndTokenHash.mockResolvedValue(1)
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})

    try {
      await expect(authService.requestPasswordReset('taro@example.com')).resolves.toBeUndefined()
      // idだけでなく発行したtokenHashも条件に渡す（並行requestで後発トークンを誤削除しないため）
      expect(prtDeleteByIdAndTokenHash).toHaveBeenCalledWith(savedPasswordResetToken.id, expect.any(String))
    } finally {
      errorSpy.mockRestore()
    }
  })

  test('補償削除自体が失敗してもrequestは正常終了する（best-effort）', async () => {
    findByEmail.mockResolvedValue(user)
    prtCreate.mockResolvedValue(savedPasswordResetToken)
    notifierSend.mockRejectedValue(new Error('SMTP error'))
    prtDeleteByIdAndTokenHash.mockRejectedValue(new Error('DB error'))
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})

    try {
      // 補償削除の例外を握りつぶし、エンドポイントは202相当の正常終了を維持する
      await expect(authService.requestPasswordReset('taro@example.com')).resolves.toBeUndefined()
      expect(prtDeleteByIdAndTokenHash).toHaveBeenCalledTimes(1)
    } finally {
      errorSpy.mockRestore()
    }
  })

  test('配送失敗時は運用検知用ログを出力し、メール・トークンを含めない', async () => {
    findByEmail.mockResolvedValue(user)
    prtCreate.mockResolvedValue(savedPasswordResetToken)
    prtDeleteByIdAndTokenHash.mockResolvedValue(1)
    notifierSend.mockRejectedValue(new Error('Resend API error'))
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})

    try {
      await expect(authService.requestPasswordReset('taro@example.com')).resolves.toBeUndefined()

      // 配送失敗が運用検知できるようログが出ている
      expect(errorSpy).toHaveBeenCalledTimes(1)
      // ただしメールアドレス・平文トークンなどの機密はログに含めない
      const sentToken = (notifierSend.mock.calls[0]?.[0] as { token: string }).token
      const logged = JSON.stringify(errorSpy.mock.calls)
      expect(logged).not.toContain('taro@example.com')
      expect(logged).not.toContain(sentToken)
    } finally {
      errorSpy.mockRestore()
    }
  })

  test('IP単位の閾値超過時は429を投げ、トークン発行・通知を行わない', async () => {
    findByEmail.mockResolvedValue(null)
    const infoSpy = spyOn(console, 'info').mockImplementation(() => {})

    try {
      for (let i = 0; i < 5; i++) {
        await expect(authService.requestPasswordReset(`user-${i}@example.com`, '203.0.113.10')).resolves.toBeUndefined()
      }

      await expect(authService.requestPasswordReset('user-6@example.com', '203.0.113.10')).rejects.toMatchObject({
        statusCode: 429,
      })

      expect(prtCreate).not.toHaveBeenCalled()
      expect(notifierSend).not.toHaveBeenCalled()
      expect(infoSpy).toHaveBeenCalledWith('パスワードリセットリクエストをIP単位で制限しました', expect.objectContaining({ scope: 'ip' }))
    } finally {
      infoSpy.mockRestore()
    }
  })

  test('email単位の閾値超過時は202相当で正常終了し、トークン発行・通知を行わない', async () => {
    findByEmail.mockResolvedValue(user)
    prtCreate.mockResolvedValue(savedPasswordResetToken)
    notifierSend.mockResolvedValue(undefined)

    await authService.requestPasswordReset('taro@example.com')
    await authService.requestPasswordReset('taro@example.com')
    await authService.requestPasswordReset('taro@example.com')
    prtCreate.mockClear()
    notifierSend.mockClear()
    findByEmail.mockClear()
    passwordResetRequestDelayMs.mockClear()

    const infoSpy = spyOn(console, 'info').mockImplementation(() => {})

    try {
      await expect(authService.requestPasswordReset('taro@example.com')).resolves.toBeUndefined()

      expect(findByEmail).not.toHaveBeenCalled()
      expect(prtCreate).not.toHaveBeenCalled()
      expect(notifierSend).not.toHaveBeenCalled()
      expect(passwordResetRequestDelayMs).toHaveBeenCalledTimes(1)
      const logged = JSON.stringify(infoSpy.mock.calls)
      expect(logged).not.toContain('taro@example.com')
      expect(infoSpy).toHaveBeenCalledWith('パスワードリセットリクエストをemail単位で制限しました', expect.objectContaining({ scope: 'email' }))
    } finally {
      infoSpy.mockRestore()
    }
  })

  test('email単位の制限キーは大文字小文字を正規化して扱う', async () => {
    findByEmail.mockResolvedValue(user)
    prtCreate.mockResolvedValue(savedPasswordResetToken)
    notifierSend.mockResolvedValue(undefined)
    const infoSpy = spyOn(console, 'info').mockImplementation(() => {})

    try {
      await authService.requestPasswordReset('TARO@example.com')
      await authService.requestPasswordReset('taro@example.com')
      await authService.requestPasswordReset('taro@EXAMPLE.com')
      prtCreate.mockClear()
      notifierSend.mockClear()

      await expect(authService.requestPasswordReset('taro@example.com')).resolves.toBeUndefined()

      expect(prtCreate).not.toHaveBeenCalled()
      expect(notifierSend).not.toHaveBeenCalled()
    } finally {
      infoSpy.mockRestore()
    }
  })
})

describe('authService.logoutAll', () => {
  test('全リフレッシュトークンを失効させるためrevokeAllByUserIdをuserIdで呼び出す', async () => {
    revokeAllByUserId.mockResolvedValue(2)

    await authService.logoutAll(1)

    expect(revokeAllByUserId).toHaveBeenCalledWith(1)
  })

  test('失効対象が存在しない場合（revokeAllByUserId が0件）も正常終了する', async () => {
    revokeAllByUserId.mockResolvedValue(0)

    await expect(authService.logoutAll(1)).resolves.toBeUndefined()
  })
})

describe('authService.listSessions', () => {
  const createdAt = new Date('2026-06-01T00:00:00.000Z')
  const expiresAt = new Date('2026-07-01T00:00:00.000Z')
  const lastUsedAt = new Date('2026-06-20T00:00:00.000Z')

  test('repositoryから取得したRefreshSession配列をDTOへ変換して返すこと（id=familyId）', async () => {
    findActiveSessionsByUserId.mockResolvedValue([{ familyId: 'family-uuid-1', createdAt, expiresAt, lastUsedAt }])

    const sessions = await authService.listSessions(1)

    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe('family-uuid-1')
    expect(sessions[0].createdAt).toEqual(createdAt)
    expect(sessions[0].expiresAt).toEqual(expiresAt)
    expect(sessions[0].lastUsedAt).toEqual(lastUsedAt)
  })

  test('レスポンスにtokenHash等の内部値を含まないこと（各要素のキーがid/createdAt/expiresAt/lastUsedAtのみ）', async () => {
    findActiveSessionsByUserId.mockResolvedValue([{ familyId: 'family-uuid-1', createdAt, expiresAt, lastUsedAt }])

    const sessions = await authService.listSessions(1)

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

    const sessions = await authService.listSessions(1)

    expect(sessions).toEqual([])
  })

  test('findActiveSessionsByUserId が渡したuserIdでcallされること', async () => {
    findActiveSessionsByUserId.mockResolvedValue([])

    await authService.listSessions(42)

    expect(findActiveSessionsByUserId).toHaveBeenCalledWith(42)
  })
})

describe('authService.confirmPasswordReset', () => {
  test('有効なトークンでパスワードを更新する', async () => {
    prtFindByTokenHash.mockResolvedValue(savedPasswordResetToken)
    prtConfirm.mockResolvedValue(true)

    await expect(authService.confirmPasswordReset('plain-reset-token', 'new-password-123')).resolves.toBeUndefined()
    expect(prtConfirm).toHaveBeenCalledTimes(1)
    // 平文パスワードをDB保存しない（ハッシュ化された値を渡す）
    const [_tokenId, _userId, hashedPassword] = prtConfirm.mock.calls[0] as [number, number, string]
    expect(hashedPassword).not.toBe('new-password-123')
    expect(hashedPassword.length).toBeGreaterThan(0)
  })

  test('存在しないトークンは401エラーを投げる', async () => {
    prtFindByTokenHash.mockResolvedValue(null)

    await expect(authService.confirmPasswordReset('unknown-token', 'new-password-123')).rejects.toThrow('無効なトークンです')
    expect(prtConfirm).not.toHaveBeenCalled()
  })

  test('期限切れトークンは401エラーを投げる', async () => {
    prtFindByTokenHash.mockResolvedValue({ ...savedPasswordResetToken, expiresAt: new Date(Date.now() - 1) })

    await expect(authService.confirmPasswordReset('expired-token', 'new-password-123')).rejects.toThrow('無効なトークンです')
    expect(prtConfirm).not.toHaveBeenCalled()
  })

  test('使用済みトークンは401エラーを投げる', async () => {
    prtFindByTokenHash.mockResolvedValue({ ...savedPasswordResetToken, usedAt: new Date() })

    await expect(authService.confirmPasswordReset('used-token', 'new-password-123')).rejects.toThrow('無効なトークンです')
    expect(prtConfirm).not.toHaveBeenCalled()
  })

  test('confirmがfalseを返した場合（並行競合）は401エラーを投げる', async () => {
    prtFindByTokenHash.mockResolvedValue(savedPasswordResetToken)
    prtConfirm.mockResolvedValue(false)

    await expect(authService.confirmPasswordReset('concurrent-token', 'new-password-123')).rejects.toThrow('無効なトークンです')
  })

  test('confirm成功後は全refresh tokenの失効が呼ばれる（repositoryのconfirmで実行される）', async () => {
    prtFindByTokenHash.mockResolvedValue(savedPasswordResetToken)
    prtConfirm.mockResolvedValue(true)

    await authService.confirmPasswordReset('plain-reset-token', 'new-password-123')

    // confirm が success の場合、repository.confirm 内で全refresh失効が実行される
    expect(prtConfirm).toHaveBeenCalledWith(savedPasswordResetToken.id, savedPasswordResetToken.userId, expect.any(String))
  })
})
