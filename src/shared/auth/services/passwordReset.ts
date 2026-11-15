import { createHmac, randomBytes } from 'node:crypto'

import { sendResendEmail } from '@/libs/resend'
import { resolveExternalApiErrorType, resolveExternalApiStatusCode, traceExternalApiCall } from '@/libs/telemetry/external'
import { AppError } from '@/utils/errors'

import { createScalarAuthEmail } from './scalarEmail'

/** パスワードリセットトークンの有効期間（1時間）。 */
export const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000

/**
 * 環境変数からパスワードリセットトークンのHMAC鍵を取得する。未設定なら500エラー。
 */
const getPasswordResetTokenSecret = (): string => {
  const secret = process.env.PASSWORD_RESET_TOKEN_SECRET
  if (!secret) {
    throw new AppError(500, 'PASSWORD_RESET_TOKEN_SECRETが設定されていません')
  }
  return secret
}

/**
 * パスワードリセットトークンをHMAC-SHA256でハッシュ化する。
 * 鍵には PASSWORD_RESET_TOKEN_SECRET を使用する。
 */
export const hashPasswordResetToken = (token: string): string => {
  return createHmac('sha256', getPasswordResetTokenSecret()).update(token).digest('hex')
}

/**
 * 発行したパスワードリセットトークンと永続化に必要な値。
 */
export type IssuedPasswordResetToken = {
  token: string
  tokenHash: string
  expiresAt: Date
}

/**
 * パスワードリセットトークンと永続化に必要な値を生成する。
 * 有効期間は PASSWORD_RESET_TOKEN_TTL_MS（1時間）。
 */
export const issuePasswordResetToken = (): IssuedPasswordResetToken => {
  const token = randomBytes(32).toString('base64url')
  return {
    token,
    tokenHash: hashPasswordResetToken(token),
    expiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS),
  }
}

/**
 * パスワードリセット通知の送信パラメータ。
 */
export type PasswordResetNotifierParams = {
  email: string
  token: string
}

/**
 * パスワードリセット通知の境界インタフェース。
 * 実Resend配送はIssue #44で実装する。
 */
export type PasswordResetNotifier = {
  send: (params: PasswordResetNotifierParams) => Promise<void>
}

/**
 * 環境変数からパスワードリセットメールの送信元アドレスを取得する。未設定なら500エラー。
 */
const getPasswordResetFromEmail = (): string => {
  const from = process.env.PASSWORD_RESET_FROM_EMAIL
  if (!from) {
    throw new AppError(500, 'PASSWORD_RESET_FROM_EMAILが設定されていません')
  }
  return from
}

/**
 * 環境変数からパスワードリセットページのベースURLを取得する。未設定なら500エラー。
 */
const getPasswordResetUrlBase = (): string => {
  const urlBase = process.env.PASSWORD_RESET_URL_BASE
  if (!urlBase) {
    throw new AppError(500, 'PASSWORD_RESET_URL_BASEが設定されていません')
  }
  return urlBase
}

/**
 * パスワードリセット通知のResend実装。
 * Resend APIを使い、リセットURLを含むメールを送信する。
 * 平文トークン・メールアドレス・APIキーをログへ出力しない。
 * Resendが同期的にエラーを返した場合はthrowし、呼び出し元の補償処理を起動する。
 */
export const passwordResetNotifier: PasswordResetNotifier = {
  send: async (params: PasswordResetNotifierParams): Promise<void> => {
    const from = getPasswordResetFromEmail()
    const urlBase = getPasswordResetUrlBase()
    const resetUrl = `${urlBase}?token=${params.token}`
    const ttlHours = PASSWORD_RESET_TOKEN_TTL_MS / (60 * 60 * 1000)
    const scalarEmail = createScalarAuthEmail({ url: urlBase, token: params.token, endpoint: '/auth/password-reset/confirm', ttlHours, passwordReset: true })

    const { error } = await traceExternalApiCall(
      {
        host: 'api.resend.com',
        method: 'POST',
        operation: 'emails.send',
        resolveResult: (result: Awaited<ReturnType<typeof sendResendEmail>>) => ({
          errorType: resolveExternalApiErrorType(result.error),
          statusCode: resolveExternalApiStatusCode(result.error),
          success: !result.error,
        }),
        system: 'resend',
      },
      () =>
        sendResendEmail({
          from,
          to: params.email,
          subject: 'パスワード再設定のご案内',
          text:
            scalarEmail?.text ??
            [
              'パスワードの再設定が申請されました。',
              '',
              '以下のURLからパスワードを再設定してください。',
              resetUrl,
              '',
              `このURLの有効期限は${ttlHours}時間です。`,
              '',
              'このメールに心当たりがない場合は、操作は不要です。このメールを無視してください。',
              'パスワードやリセット用URLを他者へ共有・返信しないでください。',
            ].join('\n'),
          html:
            scalarEmail?.html ??
            [
              '<p>パスワードの再設定が申請されました。</p>',
              '<p>以下のURLからパスワードを再設定してください。</p>',
              `<p><a href="${resetUrl}">${resetUrl}</a></p>`,
              `<p>このURLの有効期限は${ttlHours}時間です。</p>`,
              '<hr>',
              '<p>このメールに心当たりがない場合は、操作は不要です。このメールを無視してください。</p>',
              '<p>パスワードやリセット用URLを他者へ共有・返信しないでください。</p>',
            ].join('\n'),
        }),
    )

    if (error) {
      // Resend APIがエラーを返した場合はthrowし、呼び出し元の補償処理を起動する
      throw new Error(`メール送信に失敗しました: ${error.name}`)
    }
  },
}
