import { describe, expect, test } from 'bun:test'

import { getInvitationEmailConfig } from './emailConfig'

const env = {
  ENABLE_INVITATION_EMAIL: 'true',
  ENABLE_API_DOCS: 'true',
  INVITATION_EMAIL_FROM: 'sender@example.com',
  INVITATION_EMAIL_SCALAR_URL: 'https://example.com/open-api/scalar',
  RESEND_API_KEY: 'test-key',
  AUTH_EMAIL_MODE: 'link',
}

describe('招待メール設定', () => {
  test('明示的に有効にした場合だけ送信設定を読み込む', () => {
    expect(getInvitationEmailConfig({})).toBeUndefined()
    expect(getInvitationEmailConfig({ ENABLE_INVITATION_EMAIL: 'false' })).toBeUndefined()
    expect(getInvitationEmailConfig(env)).toEqual({
      fromEmail: 'sender@example.com',
      scalarUrl: 'https://example.com/open-api/scalar',
      templateVersion: 1,
    })
  })

  test.each([
    { ENABLE_INVITATION_EMAIL: 'yes' },
    { ENABLE_API_DOCS: 'false' },
    { RESEND_API_KEY: '' },
    { INVITATION_EMAIL_FROM: 'invalid' },
    { INVITATION_EMAIL_SCALAR_URL: 'http://example.com/open-api/scalar' },
    { INVITATION_EMAIL_SCALAR_URL: 'https://example.com/open-api/scalar?' },
    { INVITATION_EMAIL_SCALAR_URL: 'https://example.com/open-api/scalar#' },
    { INVITATION_EMAIL_SCALAR_URL: 'https://user@example.com/open-api/scalar' },
    { INVITATION_EMAIL_SCALAR_URL: 'https://example.com/' },
  ])('不正な設定を拒否する %p', (overrides) => {
    expect(() => getInvitationEmailConfig({ ...env, ...overrides })).toThrow()
  })
})
