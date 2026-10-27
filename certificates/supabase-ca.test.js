import { test } from 'bun:test'

import { verifySupabaseCa } from '../scripts/verify-certificate.mjs'

test('Supabase公開CAの識別情報と残存有効期限を検証する', () => {
  verifySupabaseCa(new URL('./supabase-root-2021.crt', import.meta.url))
})
