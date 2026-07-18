import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

process.env.RESEND_API_KEY = 'test-resend-api-key'

const mockEmailsSend = mock()
const receivedApiKeys: string[] = []

await mock.module('resend', () => ({
  Resend: class {
    constructor(apiKey: string) {
      receivedApiKeys.push(apiKey)
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    get emails() {
      return { send: mockEmailsSend }
    }
  },
}))

const { sendResendEmail } = await import('.')

describe('sendResendEmail', () => {
  beforeEach(() => {
    mockEmailsSend.mockReset()
    receivedApiKeys.length = 0
  })

  afterEach(() => {
    process.env.RESEND_API_KEY = 'test-resend-api-key'
  })

  test('環境変数のAPIキーでクライアントを生成してメールを送信する', async () => {
    const response = { data: { id: 'email-id' }, error: null, headers: null }
    mockEmailsSend.mockResolvedValue(response)
    const options = {
      from: 'noreply@example.com',
      to: 'user@example.com',
      subject: 'テストメール',
      text: '本文',
    }

    await expect(sendResendEmail(options)).resolves.toEqual(response)

    expect(receivedApiKeys).toEqual(['test-resend-api-key'])
    expect(mockEmailsSend).toHaveBeenCalledWith(options)
  })

  test('APIキーが未設定ならエラーを投げる', () => {
    delete process.env.RESEND_API_KEY

    expect(() => sendResendEmail({ from: 'noreply@example.com', to: 'user@example.com', subject: 'テスト', text: '本文' })).toThrow(
      'RESEND_API_KEYが設定されていません',
    )
    expect(mockEmailsSend).not.toHaveBeenCalled()
  })
})
