import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'

import { validatePasswordVerification } from './passwordFormat.mjs'

/** 既存のPHC設定を保ったままhash-wasmで計算し、比較は定時間で行う。 */
export const createModernPasswordHasher = (argon2id) => {
  let pending = Promise.resolve()
  const calculate = (password, salt) => argon2id({ password, salt, iterations: 2, parallelism: 1, memorySize: 65536, hashLength: 32, outputType: 'binary' })
  const compare = async (password, salt, expected) => {
    const actual = await calculate(password, salt)
    try {
      return actual.length === expected.length && timingSafeEqual(actual, expected)
    } finally {
      actual.fill(0)
    }
  }
  const serialize = (operation) => {
    // 同一isolateで64MiBの作業領域を同時に複数確保しない。計算や検証結果はキャッシュしない。
    const result = pending.then(operation)
    pending = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
  return {
    /** 既存Bunハッシュに対する検証だけを1回行う。 */
    verify(input) {
      const { salt, expected } = validatePasswordVerification(input)
      return serialize(() => compare(input.password, salt, expected))
    },
    /** 検証と新規生成の両方向で、Bunと同じPHC形式を維持する。 */
    check(input) {
      const { salt, expected } = validatePasswordVerification(input)
      return serialize(async () => {
        const verified = await compare(input.password, salt, expected)
        const wrongPasswordRejected = !(await compare(`${input.password}!incorrect`, salt, expected))
        const newSalt = crypto.getRandomValues(new Uint8Array(32))
        const output = await calculate(input.password, newSalt)
        try {
          const encode = (value) => Buffer.from(value).toString('base64').replace(/=+$/, '')
          return { verified, wrongPasswordRejected, workerHash: `$argon2id$v=19$m=65536,t=2,p=1$${encode(newSalt)}$${encode(output)}` }
        } finally {
          output.fill(0)
        }
      })
    },
  }
}

/** 単一検証だけを必要とする比較テストへ、共有キュー付きの関数を渡す。 */
export const createModernPasswordVerifier = (argon2id) => createModernPasswordHasher(argon2id).verify
