import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'

import { createAccessVerifier } from '../access'

const issuer = 'https://test-team.cloudflareaccess.com'
const audience = 'test-audience'
const keys = await generateKeyPair('RS256', { extractable: true })
const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'test', alg: 'RS256', use: 'sig' }
let fetchMock: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>
beforeAll(() => {
  fetchMock = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0]) => {
        expect(String(input)).toBe(`${issuer}/cdn-cgi/access/certs`)
        return Response.json({ keys: [jwk] })
      },
      { preconnect: () => undefined },
    ),
  )
})
afterAll(() => fetchMock.mockRestore())

/** Accessの署名付き合成トークンを作る。 */
const sign = (options: { issuer?: string; audience?: string; expired?: boolean } = {}): Promise<string> =>
  new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? audience)
    .setIssuedAt()
    .setExpirationTime(options.expired ? '0s' : '1h')
    .sign(keys.privateKey)

test('Access設定は固定のHTTPSチームURLとaudienceを必須にする', () => {
  for (const config of [
    {},
    { ACCESS_ISSUER: 'http://test-team.cloudflareaccess.com', ACCESS_AUDIENCE: audience },
    { ACCESS_ISSUER: 'https://attacker.invalid', ACCESS_AUDIENCE: audience },
  ]) {
    expect(() => createAccessVerifier(config)).toThrow()
  }
})

test('Access JWTの署名・issuer・audience・期限を検証し、アプリのAuthorizationとは区別する', async () => {
  const verify = createAccessVerifier({ ACCESS_ISSUER: issuer, ACCESS_AUDIENCE: audience })
  const authorized = await sign()
  expect(await verify(new Request('https://app.example.invalid', { headers: { authorization: `Bearer ${authorized}` } }))).toBe(false)
  for (const token of [
    'invalid',
    await sign({ audience: 'other' }),
    await sign({ issuer: 'https://other.cloudflareaccess.com' }),
    await sign({ expired: true }),
  ]) {
    expect(await verify(new Request('https://app.example.invalid', { headers: { 'cf-access-jwt-assertion': token } }))).toBe(false)
  }
  expect(
    await verify(new Request('https://app.example.invalid', { headers: { 'cf-access-jwt-assertion': authorized, authorization: 'Bearer app-token' } })),
  ).toBe(true)
  expect(fetchMock).toHaveBeenCalledTimes(1)
})
