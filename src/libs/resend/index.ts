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

export const resendDeliveryTimeoutMs = 10_000

export type ResendDeliveryResult =
  | { kind: 'accepted'; emailId: string }
  | { kind: 'retry'; reason: 'transport' | 'server' | 'rate_limited' | 'concurrent'; unknown: boolean }
  | { kind: 'rejected'; reason: 'invalid_idempotency' | 'client' }

/** 冪等キーと応答本文の読み取りまでの制限時間を指定し、外部のエラー詳細は保持しない。 */
export const deliverResendEmail = async (
  payload: { from: string; to: string; subject: string; text: string },
  idempotencyKey: string,
): Promise<ResendDeliveryResult> => {
  const apiKey = getResendApiKey()
  try {
    // SDKの送信APIではAbortSignalを指定できないため、期限を設けられるfetchを使う。
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(resendDeliveryTimeoutMs),
    })
    if (response.ok) {
      const body = (await response.json()) as { id?: unknown } | null
      if (typeof body?.id === 'string' && body.id.length > 0) return { kind: 'accepted', emailId: body.id }
      return { kind: 'retry', reason: 'transport', unknown: true }
    }
    if (response.status >= 500) return { kind: 'retry', reason: 'server', unknown: true }
    if (response.status === 429) return { kind: 'retry', reason: 'rate_limited', unknown: false }
    if (response.status === 409) {
      const body = (await response.json()) as { name?: unknown } | null
      if (body?.name === 'concurrent_idempotent_requests') return { kind: 'retry', reason: 'concurrent', unknown: true }
      if (body?.name === 'invalid_idempotent_request') return { kind: 'rejected', reason: 'invalid_idempotency' }
    }
    return { kind: 'rejected', reason: 'client' }
  } catch {
    return { kind: 'retry', reason: 'transport', unknown: true }
  }
}
