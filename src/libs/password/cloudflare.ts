import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'

import noSimdWasm from 'argon2id/dist/no-simd.wasm'
import simdWasm from 'argon2id/dist/simd.wasm'
import setupWasm from 'argon2id/lib/setup.js'

import type { PasswordProvider } from '@/utils/runtime'

type Hasher = (input: { password: Uint8Array; salt: Uint8Array; parallelism: number; passes: number; memorySize: number; tagLength: number }) => Uint8Array
let hasherPromise: Promise<Hasher> | undefined

/** 約65MiBのWasmをisolateで一度だけ初期化し、初回の並行呼び出しも同じ初期化を待つ。 */
const getHasher = (): Promise<Hasher> => {
  hasherPromise ??= setupWasm(
    (imports: WebAssembly.Imports) => ({ instance: new WebAssembly.Instance(simdWasm, imports) }),
    (imports: WebAssembly.Imports) => ({ instance: new WebAssembly.Instance(noSimdWasm, imports) }),
  ) as Promise<Hasher>
  return hasherPromise
}

/** 計算中はawaitしないため、Wasmの可変メモリに他のリクエストが割り込まない。 */
const calculate = (hasher: Hasher, password: string, salt: Uint8Array): Uint8Array =>
  hasher({ password: new TextEncoder().encode(password), salt, parallelism: 1, passes: 2, memorySize: 65536, tagLength: 32 })

/** Bun既定のArgon2id v19・64MiB・2回・p=1・salt/tag各32bytesを維持する。 */
export const cloudflarePassword: PasswordProvider = {
  hash: async (password) => {
    const hasher = await getHasher()
    const salt = crypto.getRandomValues(new Uint8Array(32))
    const output = calculate(hasher, password, salt)
    const encode = (value: Uint8Array): string => Buffer.from(value).toString('base64').replace(/=+$/, '')
    return `$argon2id$v=19$m=65536,t=2,p=1$${encode(salt)}$${encode(output)}`
  },
  verify: async (password, hash) => {
    // 保存値が破損した場合や想定外の計算量指定はfail-closedにする。
    const match = /^\$argon2id\$v=19\$m=65536,t=2,p=1\$([A-Za-z0-9+/]{43})\$([A-Za-z0-9+/]{43})$/.exec(hash)
    if (!match) return false
    const salt = Buffer.from(match[1], 'base64')
    const expected = Buffer.from(match[2], 'base64')
    const hasher = await getHasher()
    const actual = calculate(hasher, password, salt)
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  },
}
