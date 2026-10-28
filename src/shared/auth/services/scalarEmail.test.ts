import { afterEach, describe, expect, test } from 'bun:test'

import { createScalarAuthEmail } from './scalarEmail'

const originalMode = process.env.AUTH_EMAIL_MODE
const params = { url: 'https://example.run.app/open-api/scalar', token: 'verification-token', endpoint: '/auth/email-verification/confirm', ttlHours: 24 }

afterEach(() => {
  if (originalMode === undefined) delete process.env.AUTH_EMAIL_MODE
  else process.env.AUTH_EMAIL_MODE = originalMode
})

describe('Scalarで手動確認するメール', () => {
  test('固定リンクと入力用トークンを分けて案内し、URLへトークンを含めない', () => {
    process.env.AUTH_EMAIL_MODE = 'scalar'
    const result = createScalarAuthEmail(params)

    expect(result?.text).toContain(params.token)
    expect(result?.text).toContain(`POST ${params.endpoint}`)
    expect(result?.text).toContain('24時間')
    expect(result?.html).toContain(`href="${params.url}"`)
    expect(result?.html).not.toContain('?token=')
    expect(result?.text).toContain('リンクを開くだけでは操作は完了しません')
  })

  test('パスワード再設定では実APIのpassword欄を案内する', () => {
    process.env.AUTH_EMAIL_MODE = 'scalar'
    const result = createScalarAuthEmail({ ...params, passwordReset: true, endpoint: '/auth/password-reset/confirm', ttlHours: 1 })
    expect(result?.text).toContain('password欄')
    expect(result?.text).toContain('1時間')
  })

  test('HTMLへ埋め込む入力値をエスケープする', () => {
    process.env.AUTH_EMAIL_MODE = 'scalar'
    const result = createScalarAuthEmail({ ...params, token: '<script>"&' })
    expect(result?.html).toContain('&lt;script&gt;&quot;&amp;')
    expect(result?.html).not.toContain('<script>')
  })

  test('linkまたは未設定では従来のメール形式を使う', () => {
    delete process.env.AUTH_EMAIL_MODE
    expect(createScalarAuthEmail(params)).toBeNull()
    process.env.AUTH_EMAIL_MODE = 'link'
    expect(createScalarAuthEmail(params)).toBeNull()
  })

  test('不正なモードやトークンを含み得るリンクを拒否する', () => {
    process.env.AUTH_EMAIL_MODE = 'unknown'
    expect(() => createScalarAuthEmail(params)).toThrow('AUTH_EMAIL_MODE')
    process.env.AUTH_EMAIL_MODE = 'scalar'
    for (const url of ['http://example.com', `${params.url}?token=secret`, `${params.url}#secret`]) {
      expect(() => createScalarAuthEmail({ ...params, url })).toThrow('HTTPS URL')
    }
  })
})
