import { z } from 'zod'

import type { InvitationEmailSnapshot } from '../entities/emailDelivery'

/** 招待配信を有効にしたアプリの設定を検証する。 */
export const getInvitationEmailConfig = (env: NodeJS.ProcessEnv = process.env): InvitationEmailSnapshot | undefined => {
  const enabled = env.ENABLE_INVITATION_EMAIL
  if (enabled === undefined || enabled === 'false') return undefined
  if (enabled !== 'true') throw new Error('ENABLE_INVITATION_EMAILにはtrueまたはfalseを指定してください')
  if (env.ENABLE_API_DOCS !== 'true') throw new Error('招待メールの配信にはENABLE_API_DOCS=trueが必要です')
  if (!env.RESEND_API_KEY?.trim()) throw new Error('招待メールの配信にはRESEND_API_KEYが必要です')

  const sender = z.email().safeParse(env.INVITATION_EMAIL_FROM)
  if (!sender.success) throw new Error('INVITATION_EMAIL_FROMに検証済みの送信元メールアドレスを指定してください')

  const inputUrl = env.INVITATION_EMAIL_SCALAR_URL
  const url = inputUrl ? URL.parse(inputUrl) : null
  if (
    !url ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.href.includes('?') ||
    url.href.includes('#') ||
    url.pathname !== '/open-api/scalar'
  ) {
    throw new Error('INVITATION_EMAIL_SCALAR_URLに固定のHTTPS Scalar URLを指定してください')
  }

  return { fromEmail: sender.data, scalarUrl: url.href, templateVersion: 1 }
}
