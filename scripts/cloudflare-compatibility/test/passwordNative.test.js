import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

import * as Bun from 'bun'

import { createNativePasswordVerifier } from '../passwordNative.mjs'

test('既存Bunハッシュの設定を維持して、文字種・NUL・不正解をC実装のWasmで検証する', async () => {
  // ローカルテストだけでコンパイルし、配備時はpasswordFast.mjsの静的importを使う。
  const wasm = new WebAssembly.Module(await readFile(new URL('../node_modules/argon2-browser/dist/argon2-simd.wasm', import.meta.url)))
  const verify = createNativePasswordVerifier(wasm)
  for (const password of ['Cloudflare-check-password-2026', '日本語のパスワード🔐検証2026', 'a'.repeat(256), 'password\u0000末尾を保持する']) {
    const bunHash = await Bun.password.hash(password)
    expect(verify({ password, bunHash })).toBe(true)
    expect(verify({ password: `${password}!incorrect`, bunHash })).toBe(false)
    expect(() => verify({ password, bunHash: bunHash.replace('m=65536', 'm=131072') })).toThrow()
  }
})
