import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'

// 環境変数をテスト用に設定する
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret'
process.env.PASSWORD_RESET_TOKEN_SECRET = 'test-password-reset-secret'
process.env.PASSWORD_RESET_FROM_EMAIL = 'noreply@example.com'
process.env.PASSWORD_RESET_URL_BASE = 'https://example.com/reset-password'

/** Resendクライアント層のメール送信モック。 */
const sendResendEmail = mock()

await mock.module('@/libs/resend', () => ({
  sendResendEmail,
}))

const { hashRefreshToken } = await import('.')
const { hashPasswordResetToken, issuePasswordResetToken, PASSWORD_RESET_TOKEN_TTL_MS, passwordResetNotifier } = await import('./passwordReset')

describe('hashPasswordResetToken', () => {
  test('同じtoken/secretで同じHMAC、異なるtokenで異なるHMACを生成する', () => {
    expect(hashPasswordResetToken('reset-token')).toBe(hashPasswordResetToken('reset-token'))
    expect(hashPasswordResetToken('reset-token')).not.toBe(hashPasswordResetToken('other-token'))
    expect(hashPasswordResetToken('reset-token')).toHaveLength(64)
    expect(hashPasswordResetToken('reset-token')).not.toBe('reset-token')
  })

  test('専用鍵を使う（リフレッシュトークンのHMACとは異なる）', () => {
    expect(hashPasswordResetToken('same-token')).not.toBe(hashRefreshToken('same-token'))
  })

  test('PASSWORD_RESET_TOKEN_SECRET未設定時はエラーを投げる', () => {
    const original = process.env.PASSWORD_RESET_TOKEN_SECRET
    delete process.env.PASSWORD_RESET_TOKEN_SECRET
    try {
      expect(() => hashPasswordResetToken('reset-token')).toThrow()
    } finally {
      process.env.PASSWORD_RESET_TOKEN_SECRET = original
    }
  })
})

describe('issuePasswordResetToken', () => {
  test('32バイト相当のbase64urlトークンを発行し、tokenHashが対応する', () => {
    const result = issuePasswordResetToken()

    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/) // 32バイトのbase64url（パディングなし）
    expect(result.tokenHash).toBe(hashPasswordResetToken(result.token))
    expect(result.token).not.toBe(result.tokenHash)
  })

  test('連続発行でトークンが重複しない', () => {
    const first = issuePasswordResetToken()
    const second = issuePasswordResetToken()

    expect(first.token).not.toBe(second.token)
    expect(first.tokenHash).not.toBe(second.tokenHash)
  })

  test('発行時刻から約PASSWORD_RESET_TOKEN_TTL_MS後の有効期限を持つ', () => {
    const before = Date.now()
    const result = issuePasswordResetToken()

    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + PASSWORD_RESET_TOKEN_TTL_MS)
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS)
  })
})

describe('passwordResetNotifier.send', () => {
  beforeEach(() => {
    sendResendEmail.mockReset()
  })

  afterEach(() => {
    // 環境変数を元の状態に戻す
    process.env.PASSWORD_RESET_FROM_EMAIL = 'noreply@example.com'
    process.env.PASSWORD_RESET_URL_BASE = 'https://example.com/reset-password'
    delete process.env.AUTH_EMAIL_MODE
  })

  test('正常系: メール送信が成功する（from/to/リセットURLを含む）', async () => {
    sendResendEmail.mockResolvedValue({ data: { id: 'email-id' }, error: null })

    await expect(passwordResetNotifier.send({ email: 'user@example.com', token: 'plain-token-value' })).resolves.toBeUndefined()

    expect(sendResendEmail).toHaveBeenCalledTimes(1)
    const callArg = sendResendEmail.mock.calls[0][0] as {
      from: string
      to: string
      subject: string
      text: string
      html: string
    }
    expect(callArg.from).toBe('noreply@example.com')
    expect(callArg.to).toBe('user@example.com')
    expect(callArg.text).toContain('https://example.com/reset-password?token=plain-token-value')
    expect(callArg.html).toContain('https://example.com/reset-password?token=plain-token-value')
  })

  test('メール本文に有効期限（1時間）の案内が含まれる', async () => {
    sendResendEmail.mockResolvedValue({ data: { id: 'email-id' }, error: null })

    await passwordResetNotifier.send({ email: 'user@example.com', token: 'some-token' })

    const callArg = sendResendEmail.mock.calls[0][0] as { text: string }
    expect(callArg.text).toContain('1時間')
  })

  test('scalarモードでは固定リンクとトークンを分けて送信する', async () => {
    process.env.AUTH_EMAIL_MODE = 'scalar'
    sendResendEmail.mockResolvedValue({ data: { id: 'email-id' }, error: null })
    await passwordResetNotifier.send({ email: 'user@example.com', token: 'manual-token' })
    const value = sendResendEmail.mock.calls[0][0] as { text: string; html: string }
    expect(value.text).toContain('manual-token')
    expect(value.text).toContain('/auth/password-reset/confirm')
    expect(value.html).toContain('href="https://example.com/reset-password"')
    expect(value.html).not.toContain('?token=')
  })

  test('APIエラー: Resend SDK が { error: {...} } を返す場合は throw する', async () => {
    sendResendEmail.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'Invalid email' },
    })

    await expect(passwordResetNotifier.send({ email: 'user@example.com', token: 'plain-token' })).rejects.toThrow('メール送信に失敗しました')
  })

  test('ネットワークエラー: emails.send が reject した場合は throw が伝播する', async () => {
    sendResendEmail.mockRejectedValue(new Error('Network timeout'))

    await expect(passwordResetNotifier.send({ email: 'user@example.com', token: 'plain-token' })).rejects.toThrow('Network timeout')
  })

  test('機密情報（平文トークン・メールアドレス）をconsoleへ出力しない', async () => {
    sendResendEmail.mockResolvedValue({ data: { id: 'email-id' }, error: null })
    const consoleSpy = spyOn(console, 'info').mockImplementation(() => {})
    const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {})

    await passwordResetNotifier.send({ email: 'secret@example.com', token: 'secret-plain-token' })

    // consoleへの出力はない
    expect(consoleSpy).not.toHaveBeenCalled()
    expect(consoleErrorSpy).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  test('PASSWORD_RESET_FROM_EMAIL未設定時は throw する', async () => {
    delete process.env.PASSWORD_RESET_FROM_EMAIL

    await expect(passwordResetNotifier.send({ email: 'user@example.com', token: 'plain-token' })).rejects.toThrow(
      'PASSWORD_RESET_FROM_EMAILが設定されていません',
    )
  })

  test('PASSWORD_RESET_URL_BASE未設定時は throw する', async () => {
    delete process.env.PASSWORD_RESET_URL_BASE

    await expect(passwordResetNotifier.send({ email: 'user@example.com', token: 'plain-token' })).rejects.toThrow('PASSWORD_RESET_URL_BASEが設定されていません')
  })
})
