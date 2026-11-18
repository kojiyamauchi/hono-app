import { createRemoteJWKSet, jwtVerify } from 'jose'

/** Accessの設定値。AuthorizationはアプリのBearer認証専用として保持する。 */
export type AccessConfig = { ACCESS_ISSUER?: string; ACCESS_AUDIENCE?: string }

/** 固定のAccessチームURLから鍵を取得し、署名・発行元・対象アプリ・有効期限を検証する。 */
export const createAccessVerifier = (config: AccessConfig): ((request: Request) => Promise<boolean>) => {
  const issuer = config.ACCESS_ISSUER
  const audience = config.ACCESS_AUDIENCE
  if (!issuer || !audience || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer)) {
    throw new Error('Cloudflare Accessの発行元とaudienceを設定してください')
  }
  const keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`))
  return async (request) => {
    const token = request.headers.get('cf-access-jwt-assertion')
    if (!token) return false
    try {
      await jwtVerify(token, keys, { issuer, audience, algorithms: ['RS256'], requiredClaims: ['exp', 'iat'] })
      return true
    } catch {
      return false
    }
  }
}
