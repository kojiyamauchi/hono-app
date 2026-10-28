import { AppError } from '@/utils/errors'

/** Scalarで手動確認するメールの本文。 */
type ScalarEmailContent = { text: string; html: string }

/** メール本文のHTMLへ埋め込む値をエスケープする。 */
const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)

/**
 * scalarモードでは固定のScalar URLと手動入力用トークンを分けて案内する。
 * 未設定またはlinkモードでは既存のフロントエンド向けメールを使用する。
 */
export const createScalarAuthEmail = (params: {
  url: string
  token: string
  endpoint: string
  ttlHours: number
  passwordReset?: boolean
}): ScalarEmailContent | null => {
  const mode = process.env.AUTH_EMAIL_MODE
  if (!mode || mode === 'link') return null
  if (mode !== 'scalar') throw new AppError(500, 'AUTH_EMAIL_MODEはlinkまたはscalarで指定してください')

  const url = new URL(params.url)
  if (url.protocol !== 'https:' || url.search || url.hash) {
    throw new AppError(500, 'ScalarのURLはクエリとフラグメントのないHTTPS URLで指定してください')
  }

  const lines = [
    'このメールはScalarを使用した手動確認用です。',
    '以下のURLを開き、必要に応じて許可済みのGoogleアカウントでログインしてください。',
    params.url,
    '',
    `Scalarで POST ${params.endpoint} を選択し、次の値をtoken欄へ入力して実行してください。`,
    params.token,
    ...(params.passwordReset ? ['password欄には新しいパスワードを入力してください。'] : []),
    '',
    `このトークンの有効期限は${params.ttlHours}時間です。リンクを開くだけでは操作は完了しません。`,
    'このメールに心当たりがない場合は、操作は不要です。',
    'トークンを他者へ共有したり、チャットやログへ貼り付けたりしないでください。',
  ]

  return {
    text: lines.join('\n'),
    html: lines.map((line) => (line === params.url ? `<p><a href="${escapeHtml(line)}">Scalarを開く</a></p>` : `<p>${escapeHtml(line)}</p>`)).join('\n'),
  }
}
