import { createMiddleware } from 'hono/factory'

import { AppError } from '@/utils/errors'

/**
 * 環境変数ALLOWED_ORIGINSからカンマ区切りで許可OriginのリストをStringの配列で返す。
 * 未設定の場合は空配列を返す。
 */
export const getAllowedOrigins = (): string[] => {
  const raw = process.env.ALLOWED_ORIGINS
  if (!raw) return []
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
}

/**
 * CSRFリスクを低減するOrigin検証ミドルウェア。
 *
 * - `Origin`ヘッダーが存在しない場合: 許可（curl・モバイル・server-to-server等の非ブラウザクライアントを考慮）
 * - `Origin: null`（文字列"null"）の場合: 403で拒否
 * - `Origin`がある場合: 許可リスト（ALLOWED_ORIGINS環境変数）との完全一致のみ通過、不一致は403で拒否
 */
export const originMiddleware = createMiddleware(async (c, next) => {
  const origin = c.req.header('Origin')

  // Originヘッダーが存在しない場合は非ブラウザクライアントとして許可する
  if (origin === undefined) {
    await next()
    return
  }

  // Origin: null は明示的に拒否する（ファイルスキームなどの怪しいリクエストを防ぐ）
  if (origin === 'null') {
    throw new AppError(403, '許可されていないOriginです')
  }

  // 許可リストと完全一致するOriginのみ通過させる
  const allowedOrigins = getAllowedOrigins()
  if (!allowedOrigins.includes(origin)) {
    throw new AppError(403, '許可されていないOriginです')
  }

  await next()
})
