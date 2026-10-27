import assert from 'node:assert/strict'
import { X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'

/** 同梱Supabase CAの識別情報と更新期限を検証する。 */
export const verifySupabaseCa = (path) => {
  const root = new X509Certificate(readFileSync(path))
  assert.equal(root.ca, true)
  assert.equal(root.fingerprint256, '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA')
  assert.ok(Date.parse(root.validFrom) <= Date.now(), 'CA証明書の有効期間がまだ始まっていません')
  assert.ok(Date.parse(root.validTo) - Date.now() > 90 * 24 * 60 * 60 * 1000, 'CA証明書の更新が必要です')
}
