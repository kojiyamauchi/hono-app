import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'

/** 検証用Bearerの内容を定時間比較し、未設定の秘密値や異なる長さの入力は拒否する。 */
export const isSpikeRequestAuthorized = (request, token) => {
  if (typeof token !== 'string' || !token) return false
  const authorization = request.headers.get('authorization')
  if (!authorization) return false
  const actual = Buffer.from(authorization)
  const expected = Buffer.from(`Bearer ${token}`)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
