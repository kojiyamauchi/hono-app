import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'

import noSimdWasm from 'argon2id/dist/no-simd.wasm'
import simdWasm from 'argon2id/dist/simd.wasm'
import setupWasm from 'argon2id/lib/setup.js'

import { validatePasswordVerification } from './passwordFormat.mjs'

// 同じisolateでは同期的に計算し、初回の並行リクエストも同じWasm初期化を待つ。
// 初期化ごとに約65MiBを確保するため、リクエスト単位でインスタンスを生成しない。
let hasherPromise

/** 配備時に静的importしたWasmを使い、動的コンパイルを避ける。 */
const getHasher = () => {
  hasherPromise ??= setupWasm(
    (imports) => ({ instance: new WebAssembly.Instance(simdWasm, imports) }),
    (imports) => ({ instance: new WebAssembly.Instance(noSimdWasm, imports) }),
  )
  return hasherPromise
}

/** Bunと同じパラメーターでArgon2idを計算する。 */
const calculateHash = (hasher, password, salt) =>
  hasher({ password: new TextEncoder().encode(password), salt, parallelism: 1, passes: 2, memorySize: 65536, tagLength: 32 })

/** 検証用PHCハッシュを比較し、不一致を早期returnしない。 */
const matchesHash = (actual, expected) => {
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/** Bun生成ハッシュの検証と、Bunへ戻して検証するためのハッシュ生成を行う。 */
export const checkPasswordCompatibility = async ({ password, bunHash }) => {
  const { salt, expected } = validatePasswordVerification({ password, bunHash })
  const hasher = await getHasher()
  const verified = matchesHash(calculateHash(hasher, password, salt), expected)
  const wrongPasswordRejected = !matchesHash(calculateHash(hasher, `${password}!incorrect`, salt), expected)
  const newSalt = crypto.getRandomValues(new Uint8Array(32))
  const output = calculateHash(hasher, password, newSalt)
  const workerHash = `$argon2id$v=19$m=65536,t=2,p=1$${Buffer.from(newSalt).toString('base64').replace(/=+$/, '')}$${Buffer.from(output).toString('base64').replace(/=+$/, '')}`
  return { verified, wrongPasswordRejected, workerHash }
}

/** ログイン相当の計測用に、正しいパスワードの検証だけを1回行う。 */
export const verifyPasswordOnce = async ({ password, bunHash }) => {
  const { salt, expected } = validatePasswordVerification({ password, bunHash })
  const hasher = await getHasher()
  return matchesHash(calculateHash(hasher, password, salt), expected)
}
