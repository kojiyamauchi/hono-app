import { createHmac, randomBytes } from 'node:crypto'

import { Resend } from 'resend'

import { resolveExternalApiErrorType, resolveExternalApiStatusCode, traceExternalApiCall } from '@/libs/telemetry/external'
import { emailVerificationTokenRepository } from '@/shared/auth/repositories'
import { AppError } from '@/utils/errors'

/** メールアドレス検証トークンの有効期間（24時間）。 */
export const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

/**
 * 環境変数からメールアドレス検証トークンのHMAC鍵を取得する。
 */
const getEmailVerificationTokenSecret = (): string => {
  const secret = process.env.EMAIL_VERIFICATION_TOKEN_SECRET
  if (!secret) {
    throw new AppError(500, 'EMAIL_VERIFICATION_TOKEN_SECRETが設定されていません')
  }
  return secret
}

/**
 * メールアドレス検証トークンをHMAC-SHA256でハッシュ化する。
 */
export const hashEmailVerificationToken = (token: string): string => {
  return createHmac('sha256', getEmailVerificationTokenSecret()).update(token).digest('hex')
}

/** 発行したメールアドレス検証トークンと永続化に必要な値。 */
export type IssuedEmailVerificationToken = {
  token: string
  tokenHash: string
  expiresAt: Date
}

/**
 * メールアドレス検証トークンと永続化に必要な値を生成する。
 */
export const issueEmailVerificationToken = (): IssuedEmailVerificationToken => {
  const token = randomBytes(32).toString('base64url')
  return {
    token,
    tokenHash: hashEmailVerificationToken(token),
    expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_MS),
  }
}

/** メールアドレス検証通知の送信パラメータ。 */
export type EmailVerificationNotifierParams = {
  email: string
  token: string
}

/** メールアドレス検証通知の境界インタフェース。 */
export type EmailVerificationNotifier = {
  send: (params: EmailVerificationNotifierParams) => Promise<void>
}

/**
 * 環境変数からResend APIキーを取得する。
 */
const getResendApiKey = (): string => {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    throw new AppError(500, 'RESEND_API_KEYが設定されていません')
  }
  return key
}

/**
 * 環境変数からメールアドレス検証メールの送信元を取得する。
 */
const getEmailVerificationFromEmail = (): string => {
  const from = process.env.EMAIL_VERIFICATION_FROM_EMAIL
  if (!from) {
    throw new AppError(500, 'EMAIL_VERIFICATION_FROM_EMAILが設定されていません')
  }
  return from
}

/**
 * 環境変数からメールアドレス検証ページのベースURLを取得する。
 */
const getEmailVerificationUrlBase = (): string => {
  const urlBase = process.env.EMAIL_VERIFICATION_URL_BASE
  if (!urlBase) {
    throw new AppError(500, 'EMAIL_VERIFICATION_URL_BASEが設定されていません')
  }
  return urlBase
}

/**
 * メールアドレス検証通知のResend実装。
 */
export const emailVerificationNotifier: EmailVerificationNotifier = {
  send: async (params: EmailVerificationNotifierParams): Promise<void> => {
    const resend = new Resend(getResendApiKey())
    const from = getEmailVerificationFromEmail()
    const verificationUrl = `${getEmailVerificationUrlBase()}?token=${params.token}`
    const ttlHours = EMAIL_VERIFICATION_TOKEN_TTL_MS / (60 * 60 * 1000)

    const { error } = await traceExternalApiCall(
      {
        host: 'api.resend.com',
        method: 'POST',
        operation: 'emails.send',
        resolveResult: (result: Awaited<ReturnType<typeof resend.emails.send>>) => ({
          errorType: resolveExternalApiErrorType(result.error),
          statusCode: resolveExternalApiStatusCode(result.error),
          success: !result.error,
        }),
        system: 'resend',
      },
      () =>
        resend.emails.send({
          from,
          to: params.email,
          subject: 'メールアドレス確認のご案内',
          text: [
            'メールアドレスの確認をお願いします。',
            '',
            '以下のURLからメールアドレスを確認してください。',
            verificationUrl,
            '',
            `このURLの有効期限は${ttlHours}時間です。`,
            '',
            'このメールに心当たりがない場合は、操作は不要です。',
          ].join('\n'),
          html: [
            '<p>メールアドレスの確認をお願いします。</p>',
            '<p>以下のURLからメールアドレスを確認してください。</p>',
            `<p><a href="${verificationUrl}">${verificationUrl}</a></p>`,
            `<p>このURLの有効期限は${ttlHours}時間です。</p>`,
            '<hr>',
            '<p>このメールに心当たりがない場合は、操作は不要です。</p>',
          ].join('\n'),
        }),
    )

    if (error) {
      throw new Error(`メール送信に失敗しました: ${error.name}`)
    }
  },
}

/**
 * メールアドレス検証トークンを発行・保存して通知する。
 * 発行・保存・通知の失敗はログへ残して正常終了し、通知失敗時は保存済みトークンを補償削除する。
 */
export const sendEmailVerificationBestEffort = async (userId: number, email: string): Promise<void> => {
  let issued: IssuedEmailVerificationToken
  let savedId: number

  try {
    issued = issueEmailVerificationToken()
    const saved = await emailVerificationTokenRepository.create(userId, issued.tokenHash, issued.expiresAt)
    savedId = saved.id
  } catch (error) {
    console.error('メールアドレス検証トークンの発行または保存に失敗しました', {
      name: error instanceof Error ? error.name : 'UnknownError',
      reason: error instanceof Error ? error.message : 'unknown',
    })
    return
  }

  try {
    await emailVerificationNotifier.send({ email, token: issued.token })
  } catch (error) {
    console.error('メールアドレス検証メールの配送に失敗しました', {
      name: error instanceof Error ? error.name : 'UnknownError',
      reason: error instanceof Error ? error.message : 'unknown',
    })
    await emailVerificationTokenRepository.deleteByIdAndTokenHash(savedId, issued.tokenHash).catch(() => {
      // 補償削除に失敗しても、トークンは有効期限で失効するため握りつぶす。
    })
  }
}
