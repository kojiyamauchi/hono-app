import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
// 既存のローカル・AWS設定も利用できるよう、旧anonキー設定をフォールバックとして残す。
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL またはSupabaseの公開キーが設定されていません')
}

// サーバーサイドで利用するため、セッションの永続化・自動更新は無効化する
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})
