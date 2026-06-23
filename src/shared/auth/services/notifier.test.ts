import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'

// 環境変数をテスト用に設定する
process.env.PASSWORD_RESET_TOKEN_SECRET = 'test-password-reset-secret'
process.env.RESEND_API_KEY = 'test-resend-api-key'
process.env.PASSWORD_RESET_FROM_EMAIL = 'noreply@example.com'
process.env.PASSWORD_RESET_URL_BASE = 'https://example.com/reset-password'

/** Resend SDK の emails.send モック */
const mockEmailsSend = mock()

// Resend SDK をモックする（実際のAPI呼び出しを行わない）
await mock.module('resend', () => ({
  Resend: class {
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    get emails() {
      return { send: mockEmailsSend }
    }
  },
}))

const { passwordResetNotifier } = await import('.')

describe('passwordResetNotifier.send', () => {
  beforeEach(() => {
    mockEmailsSend.mockReset()
  })

  afterEach(() => {
    // 環境変数を元の状態に戻す
    process.env.RESEND_API_KEY = 'test-resend-api-key'
    process.env.PASSWORD_RESET_FROM_EMAIL = 'noreply@example.com'
    process.env.PASSWORD_RESET_URL_BASE = 'https://example.com/reset-password'
  })

  test('正常系: メール送信が成功する（from/to/リセットURLを含む）', async () => {
    mockEmailsSend.mockResolvedValue({ data: { id: 'email-id' }, error: null })

    await expect(passwordResetNotifier.send({ email: 'user@example.com', token: 'plain-token-value' })).resolves.toBeUndefined()

    expect(mockEmailsSend).toHaveBeenCalledTimes(1)
    const callArg = mockEmailsSend.mock.calls[0][0] as {
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
    mockEmailsSend.mockResolvedValue({ data: { id: 'email-id' }, error: null })

    await passwordResetNotifier.send({ email: 'user@example.com', token: 'some-token' })

    const callArg = mockEmailsSend.mock.calls[0][0] as { text: string }
    expect(callArg.text).toContain('1時間')
  })

  test('APIエラー: Resend SDK が { error: {...} } を返す場合は throw する', async () => {
    mockEmailsSend.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'Invalid email' },
    })

    await expect(passwordResetNotifier.send({ email: 'user@example.com', token: 'plain-token' })).rejects.toThrow('メール送信に失敗しました')
  })

  test('ネットワークエラー: emails.send が reject した場合は throw が伝播する', async () => {
    mockEmailsSend.mockRejectedValue(new Error('Network timeout'))

    await expect(passwordResetNotifier.send({ email: 'user@example.com', token: 'plain-token' })).rejects.toThrow('Network timeout')
  })

  test('機密情報（平文トークン・メールアドレス）をconsoleへ出力しない', async () => {
    mockEmailsSend.mockResolvedValue({ data: { id: 'email-id' }, error: null })
    const consoleSpy = spyOn(console, 'info').mockImplementation(() => {})
    const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {})

    await passwordResetNotifier.send({ email: 'secret@example.com', token: 'secret-plain-token' })

    // consoleへの出力はない
    expect(consoleSpy).not.toHaveBeenCalled()
    expect(consoleErrorSpy).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  test('RESEND_API_KEY未設定時は throw する', async () => {
    delete process.env.RESEND_API_KEY

    await expect(passwordResetNotifier.send({ email: 'user@example.com', token: 'plain-token' })).rejects.toThrow('RESEND_API_KEYが設定されていません')
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
