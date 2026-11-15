import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'

import type { PasswordResetToken } from '@/shared/auth/entities'
import type { User } from '@/shared/user/entities'

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
    revokeByUserIdAndFamilyId,
    findActiveSessionsByUserId,
  },
  passwordResetTokenRepository: {
    create: prtCreate,
    findByTokenHash: prtFindByTokenHash,
    deleteByIdAndTokenHash: prtDeleteByIdAndTokenHash,
    confirm: prtConfirm,
  },
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

const { passwordResetService, passwordResetRequestRateLimiter } = await import('./passwordReset')

const user: User = {
  id: 1,
  name: 'Taro',
  email: 'taro@example.com',
  password: 'hashed',
  emailVerifiedAt: null,
  createdAt: new Date('2026-06-18T00:00:00.000Z'),
  updatedAt: new Date('2026-06-18T00:00:00.000Z'),
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
  passwordResetRequestRateLimiter.reset()
})

describe('passwordResetService.request', () => {
  test('登録済みユーザーへトークンを発行し、notifierへ送信を依頼する', async () => {
    findByEmail.mockResolvedValue(user)
    prtCreate.mockResolvedValue(savedPasswordResetToken)
    notifierSend.mockResolvedValue(undefined)

    await expect(passwordResetService.request('taro@example.com')).resolves.toBeUndefined()
    expect(prtCreate).toHaveBeenCalledTimes(1)
    expect(notifierSend).toHaveBeenCalledTimes(1)
  })

  test('未登録メールアドレスの場合は何もせず正常終了する（登録有無を外部に漏らさない）', async () => {
    findByEmail.mockResolvedValue(null)

    await expect(passwordResetService.request('notregistered@example.com')).resolves.toBeUndefined()
    expect(prtCreate).not.toHaveBeenCalled()
    expect(notifierSend).not.toHaveBeenCalled()
  })

  test('DBへ平文トークンを保存しない（ハッシュ値を保存する）', async () => {
    findByEmail.mockResolvedValue(user)
    prtCreate.mockResolvedValue(savedPasswordResetToken)
    notifierSend.mockResolvedValue(undefined)

    await passwordResetService.request('taro@example.com')

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
      await expect(passwordResetService.request('taro@example.com')).resolves.toBeUndefined()
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
      await expect(passwordResetService.request('taro@example.com')).resolves.toBeUndefined()
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
      await expect(passwordResetService.request('taro@example.com')).resolves.toBeUndefined()

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
        await expect(passwordResetService.request(`user-${i}@example.com`, '203.0.113.10')).resolves.toBeUndefined()
      }

      await expect(passwordResetService.request('user-6@example.com', '203.0.113.10')).rejects.toMatchObject({
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

    await passwordResetService.request('taro@example.com')
    await passwordResetService.request('taro@example.com')
    await passwordResetService.request('taro@example.com')
    prtCreate.mockClear()
    notifierSend.mockClear()
    findByEmail.mockClear()
    passwordResetRequestDelayMs.mockClear()

    const infoSpy = spyOn(console, 'info').mockImplementation(() => {})

    try {
      await expect(passwordResetService.request('taro@example.com')).resolves.toBeUndefined()

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
      await passwordResetService.request('TARO@example.com')
      await passwordResetService.request('taro@example.com')
      await passwordResetService.request('taro@EXAMPLE.com')
      prtCreate.mockClear()
      notifierSend.mockClear()

      await expect(passwordResetService.request('taro@example.com')).resolves.toBeUndefined()

      expect(prtCreate).not.toHaveBeenCalled()
      expect(notifierSend).not.toHaveBeenCalled()
    } finally {
      infoSpy.mockRestore()
    }
  })
})

describe('passwordResetService.confirm', () => {
  test('有効なトークンでパスワードを更新する', async () => {
    prtFindByTokenHash.mockResolvedValue(savedPasswordResetToken)
    prtConfirm.mockResolvedValue(true)

    await expect(passwordResetService.confirm('plain-reset-token', 'new-password-123')).resolves.toBeUndefined()
    expect(prtConfirm).toHaveBeenCalledTimes(1)
    // 平文パスワードをDB保存しない（ハッシュ化された値を渡す）
    const [_tokenId, _userId, hashedPassword] = prtConfirm.mock.calls[0] as [number, number, string]
    expect(hashedPassword).not.toBe('new-password-123')
    expect(hashedPassword.length).toBeGreaterThan(0)
  })

  test('存在しないトークンは401エラーを投げる', async () => {
    prtFindByTokenHash.mockResolvedValue(null)

    await expect(passwordResetService.confirm('unknown-token', 'new-password-123')).rejects.toThrow('無効なトークンです')
    expect(prtConfirm).not.toHaveBeenCalled()
  })

  test('期限切れトークンは401エラーを投げる', async () => {
    prtFindByTokenHash.mockResolvedValue({ ...savedPasswordResetToken, expiresAt: new Date(Date.now() - 1) })

    await expect(passwordResetService.confirm('expired-token', 'new-password-123')).rejects.toThrow('無効なトークンです')
    expect(prtConfirm).not.toHaveBeenCalled()
  })

  test('使用済みトークンは401エラーを投げる', async () => {
    prtFindByTokenHash.mockResolvedValue({ ...savedPasswordResetToken, usedAt: new Date() })

    await expect(passwordResetService.confirm('used-token', 'new-password-123')).rejects.toThrow('無効なトークンです')
    expect(prtConfirm).not.toHaveBeenCalled()
  })

  test('confirmがfalseを返した場合（並行競合）は401エラーを投げる', async () => {
    prtFindByTokenHash.mockResolvedValue(savedPasswordResetToken)
    prtConfirm.mockResolvedValue(false)

    await expect(passwordResetService.confirm('concurrent-token', 'new-password-123')).rejects.toThrow('無効なトークンです')
  })

  test('confirm成功後は全refresh tokenの失効が呼ばれる（repositoryのconfirmで実行される）', async () => {
    prtFindByTokenHash.mockResolvedValue(savedPasswordResetToken)
    prtConfirm.mockResolvedValue(true)

    await passwordResetService.confirm('plain-reset-token', 'new-password-123')

    // confirm が success の場合、repository.confirm 内で全refresh失効が実行される
    expect(prtConfirm).toHaveBeenCalledWith(savedPasswordResetToken.id, savedPasswordResetToken.userId, expect.any(String))
  })
})
