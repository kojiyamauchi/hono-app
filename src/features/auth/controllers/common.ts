import { isIP } from 'node:net'

import type { Context } from 'hono'

/**
 * レート制限に使うクライアントIPを取得する。
 * 信頼できるエッジからのみ接続できる構成を前提に、末尾へ追記されたIPだけを使う。
 * AWSではALBのappend・ポート非付与、GCPでは追加プロキシのないCloud Run標準URLを使用する。
 * クライアントが指定できる先頭値やx-real-ipは信頼しない。公開経路変更時は信頼境界を再確認する。
 * IPを特定できない場合は、全クライアントを同じキーへ束ねないようundefinedを返す。
 */
export const getClientIp = (c: Context): string | undefined => {
  const forwardedFor = c.req.header('x-forwarded-for')
  const forwardedIp = forwardedFor?.split(',').at(-1)?.trim()
  if (forwardedIp && isIP(forwardedIp)) {
    return forwardedIp
  }

  return undefined
}
