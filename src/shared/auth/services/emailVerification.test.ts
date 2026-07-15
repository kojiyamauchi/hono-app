import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'

process.env.EMAIL_VERIFICATION_TOKEN_SECRET = 'test-email-verification-secret'
process.env.PASSWORD_RESET_TOKEN_SECRET = 'test-password-reset-secret'
process.env.RESEND_API_KEY = 'test-resend-api-key'
process.env.EMAIL_VERIFICATION_FROM_EMAIL = 'verify@example.com'
process.env.EMAIL_VERIFICATION_URL_BASE = 'https://example.com/verify-email'

const create = mock()
const deleteByIdAndTokenHash = mock()

await mock.module('@/shared/auth/repositories', () => ({
  emailVerificationTokenRepository: {
    create,
    deleteByIdAndTokenHash,
  },
}))

const mockEmailsSend = mock()

await mock.module('resend', () => ({
  Resend: class {
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    get emails() {
      return { send: mockEmailsSend }
    }
  },
}))

const {
  EMAIL_VERIFICATION_TOKEN_TTL_MS,
  emailVerificationNotifier,
  hashEmailVerificationToken,
  hashPasswordResetToken,
  issueEmailVerificationToken,
  sendEmailVerificationBestEffort,
} = await import('.')

describe('メールアドレス検証トークン', () => {
  test('専用鍵を使って同じtokenから同じHMACを生成する', () => {
    expect(hashEmailVerificationToken('verification-token')).toBe(hashEmailVerificationToken('verification-token'))
    expect(hashEmailVerificationToken('verification-token')).not.toBe(hashEmailVerificationToken('other-token'))
    expect(hashEmailVerificationToken('verification-token')).not.toBe(hashPasswordResetToken('verification-token'))
    expect(hashEmailVerificationToken('verification-token')).toHaveLength(64)
  })

  test('専用鍵が未設定ならエラーを投げる', () => {
    const original = process.env.EMAIL_VERIFICATION_TOKEN_SECRET
    delete process.env.EMAIL_VERIFICATION_TOKEN_SECRET

    try {
      expect(() => hashEmailVerificationToken('verification-token')).toThrow('EMAIL_VERIFICATION_TOKEN_SECRETが設定されていません')
    } finally {
      process.env.EMAIL_VERIFICATION_TOKEN_SECRET = original
    }
  })

  test('32バイト相当のtokenと24時間後の有効期限を発行する', () => {
    const before = Date.now()
    const result = issueEmailVerificationToken()

    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(result.tokenHash).toBe(hashEmailVerificationToken(result.token))
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + EMAIL_VERIFICATION_TOKEN_TTL_MS)
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_MS)
  })
})

describe('emailVerificationNotifier.send', () => {
  beforeEach(() => {
    mockEmailsSend.mockReset()
  })

  afterEach(() => {
    process.env.RESEND_API_KEY = 'test-resend-api-key'
    process.env.EMAIL_VERIFICATION_FROM_EMAIL = 'verify@example.com'
    process.env.EMAIL_VERIFICATION_URL_BASE = 'https://example.com/verify-email'
  })

  test('送信元・宛先・検証URL・24時間の案内を含むメールを送信する', async () => {
    mockEmailsSend.mockResolvedValue({ data: { id: 'email-id' }, error: null })

    await emailVerificationNotifier.send({ email: 'user@example.com', token: 'plain-token' })

    const callArg = mockEmailsSend.mock.calls[0][0] as { from: string; to: string; text: string; html: string }
    expect(callArg.from).toBe('verify@example.com')
    expect(callArg.to).toBe('user@example.com')
    expect(callArg.text).toContain('https://example.com/verify-email?token=plain-token')
    expect(callArg.html).toContain('https://example.com/verify-email?token=plain-token')
    expect(callArg.text).toContain('24時間')
  })

  test('Resendがエラーを返した場合はthrowする', async () => {
    mockEmailsSend.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'Invalid email' } })

    await expect(emailVerificationNotifier.send({ email: 'user@example.com', token: 'plain-token' })).rejects.toThrow('メール送信に失敗しました')
  })

  test('必要な環境変数が未設定ならthrowする', async () => {
    delete process.env.EMAIL_VERIFICATION_FROM_EMAIL
    await expect(emailVerificationNotifier.send({ email: 'user@example.com', token: 'plain-token' })).rejects.toThrow(
      'EMAIL_VERIFICATION_FROM_EMAILが設定されていません',
    )

    process.env.EMAIL_VERIFICATION_FROM_EMAIL = 'verify@example.com'
    delete process.env.EMAIL_VERIFICATION_URL_BASE
    await expect(emailVerificationNotifier.send({ email: 'user@example.com', token: 'plain-token' })).rejects.toThrow(
      'EMAIL_VERIFICATION_URL_BASEが設定されていません',
    )
  })
})

describe('sendEmailVerificationBestEffort', () => {
  beforeEach(() => {
    create.mockReset()
    deleteByIdAndTokenHash.mockReset()
    mockEmailsSend.mockReset()
    create.mockImplementation(async (userId: number, tokenHash: string, expiresAt: Date) => ({
      id: 30,
      userId,
      tokenHash,
      expiresAt,
      usedAt: null,
      createdAt: new Date(),
    }))
    mockEmailsSend.mockResolvedValue({ data: { id: 'email-id' }, error: null })
  })

  test('トークンを保存して通知する', async () => {
    await expect(sendEmailVerificationBestEffort(1, 'user@example.com')).resolves.toBeUndefined()

    expect(create).toHaveBeenCalledWith(1, expect.any(String), expect.any(Date))
    expect(mockEmailsSend).toHaveBeenCalledTimes(1)
    expect(deleteByIdAndTokenHash).not.toHaveBeenCalled()
  })

  test('トークン保存失敗時はログへ記録して正常終了する', async () => {
    create.mockRejectedValue(new Error('database unavailable'))
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})

    try {
      await expect(sendEmailVerificationBestEffort(1, 'user@example.com')).resolves.toBeUndefined()
      expect(errorSpy).toHaveBeenCalledWith('メールアドレス検証トークンの発行または保存に失敗しました', {
        name: 'Error',
        reason: 'database unavailable',
      })
      expect(mockEmailsSend).not.toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })

  test('通知失敗時は保存したトークンを条件付き削除して正常終了する', async () => {
    mockEmailsSend.mockRejectedValue(new Error('network error'))
    deleteByIdAndTokenHash.mockResolvedValue(1)
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})

    try {
      await expect(sendEmailVerificationBestEffort(1, 'user@example.com')).resolves.toBeUndefined()
      expect(deleteByIdAndTokenHash).toHaveBeenCalledWith(30, expect.any(String))
      expect(errorSpy).toHaveBeenCalledWith('メールアドレス検証メールの配送に失敗しました', {
        name: 'Error',
        reason: 'network error',
      })
    } finally {
      errorSpy.mockRestore()
    }
  })

  test('通知失敗後の補償削除にも失敗しても正常終了する', async () => {
    mockEmailsSend.mockRejectedValue(new Error('network error'))
    deleteByIdAndTokenHash.mockRejectedValue(new Error('database unavailable'))
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})

    try {
      await expect(sendEmailVerificationBestEffort(1, 'user@example.com')).resolves.toBeUndefined()
    } finally {
      errorSpy.mockRestore()
    }
  })
})
