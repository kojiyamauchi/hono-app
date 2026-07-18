import type { CreateEmailOptions, CreateEmailResponse } from 'resend'
import { Resend } from 'resend'

import { AppError } from '@/utils/errors'

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
 * Resendクライアントを生成し、メール送信APIを呼び出す。
 */
export const sendResendEmail = (options: CreateEmailOptions): Promise<CreateEmailResponse> => {
  const resend = new Resend(getResendApiKey())
  return resend.emails.send(options)
}
