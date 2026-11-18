import { createClient } from '@supabase/supabase-js'

import { getEnvironment } from '@/utils/runtime'
import { createScopedClient } from '@/utils/runtime/scopedClient'

/** セッションを永続化しないサーバー用クライアントを当該環境の設定から生成する。 */
export const createSupabaseClient = (): ReturnType<typeof createClient> => {
  const env = getEnvironment()
  const url = env.SUPABASE_URL
  const key = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('SUPABASE_URL またはSupabaseの公開キーが設定されていません')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
}

// Bunは従来どおりimport時に設定を検証する。Workersでのスコープ外利用は拒否する。
const bunClient = typeof Bun !== 'undefined' ? createSupabaseClient() : undefined
const scoped = createScopedClient(() => {
  if (!bunClient) throw new Error('Cloudflareではリクエスト専用のSupabaseクライアントが必要です')
  return bunClient
})
export const supabase = scoped.client
export const runWithSupabase = scoped.run
