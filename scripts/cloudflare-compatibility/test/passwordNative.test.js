import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

import * as Bun from 'bun'

import { createNativePasswordVerifier } from '../passwordNative.mjs'

test('Wasmの検査・初期化が失敗した場合、次の呼び出しでも初期化を試す', async () => {
  const input = { password: 'Cloudflare-check-password-2026', bunHash: await Bun.password.hash('Cloudflare-check-password-2026') }
  const emptyModule = new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))
  const invalidInterface = createNativePasswordVerifier(emptyModule)
  for (let attempt = 0; attempt < 2; attempt++) expect(() => invalidInterface(input)).toThrow('固定したWasmのインターフェースが異なります')

  // memoryと照合関数を持ち、初期化関数だけがunreachableで失敗する最小のWasm。
  const trappingModule = new WebAssembly.Module(
    new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 3, 2, 0, 0, 5, 3, 1, 0, 1, 7, 13, 3, 1, 99, 2, 0, 1, 109, 0, 1, 1, 100, 0, 0, 10, 8, 2, 3, 0, 0, 11, 2,
      0, 11,
    ]),
  )
  const failedInitialization = createNativePasswordVerifier(trappingModule)
  for (let attempt = 0; attempt < 2; attempt++) expect(() => failedInitialization(input)).toThrow(WebAssembly.RuntimeError)
})

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
