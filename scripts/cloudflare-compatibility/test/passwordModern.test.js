import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

import * as Bun from 'bun'

import { createModernPasswordHasher } from '../passwordModernVerifier.mjs'
import { prepareHashWasm } from '../prepareHashWasm.mjs'

// 64MiBの既存設定で照合・生成を繰り返すため、共有CIマシンでも設定を弱めず検証する。
test('静的Wasm化したhash-wasmで既存ハッシュを検証し、異なる並行入力を取り違えない', async () => {
  await prepareHashWasm()
  const { createStaticHashWasm } = await import('../.wrangler/hash-wasm-factory.mjs')
  const modules = {}
  for (const name of ['argon2', 'blake2b']) modules[name] = new WebAssembly.Module(await readFile(new URL(`../.wrangler/hash-${name}.wasm`, import.meta.url)))
  const { verify, check } = createModernPasswordHasher(createStaticHashWasm(modules).argon2id)
  const cases = ['Cloudflare-check-password-2026', '日本語のパスワード🔐検証2026', 'a'.repeat(256), 'password\u0000末尾を保持する']
  const inputs = await Promise.all(cases.map(async (password) => ({ password, bunHash: await Bun.password.hash(password) })))
  for (const input of inputs) {
    expect(await verify(input)).toBe(true)
    expect(await verify({ ...input, password: `${input.password}!incorrect` })).toBe(false)
    expect(() => verify({ ...input, bunHash: input.bunHash.replace('m=65536', 'm=131072') })).toThrow()
    const generated = await check(input)
    expect(generated.verified && generated.wrongPasswordRejected).toBe(true)
    expect(await Bun.password.verify(input.password, generated.workerHash)).toBe(true)
    expect(await Bun.password.verify(`${input.password}!incorrect`, generated.workerHash)).toBe(false)
  }
  expect(await Promise.all(inputs.slice(0, 2).map((input) => verify(input)))).toEqual([true, true])
}, 30_000)
