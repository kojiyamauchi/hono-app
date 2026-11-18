import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = dirname(fileURLToPath(import.meta.url))

/** 固定したhash-wasmの計算コードを変更せず、バイナリのコンパイルだけを配備時へ移す。 */
export const prepareHashWasm = async () => {
  const base = resolve(directory, 'node_modules/hash-wasm')
  const metadata = JSON.parse(await readFile(resolve(base, 'package.json'), 'utf8'))
  assert.equal(metadata.version, '4.12.0', '検証したhash-wasmのバージョンを固定してください')
  let source = await readFile(resolve(base, 'dist/index.esm.js'), 'utf8')
  const generated = resolve(directory, '.wrangler')
  await mkdir(generated, { recursive: true })
  for (const name of ['argon2', 'blake2b']) {
    const match = new RegExp(`var name[\\w$]* = "${name}";\\s*var data[\\w$]* = "([A-Za-z0-9+/=]+)";`).exec(source)
    assert(match, `${name}の固定バイナリが見つかりません`)
    await writeFile(resolve(generated, `hash-${name}.wasm`), Buffer.from(match[1], 'base64'))
  }
  const compilation = /const asm = decodeBase64\(binary\.data\);\s*const promise = WebAssembly\.compile\(asm\);/g
  assert.equal([...source.matchAll(compilation)].length, 1, 'Wasmローダーの形式が変わっています')
  source = source.replace(
    compilation,
    'const module = staticModules[binary.name]; if (!(module instanceof WebAssembly.Module)) throw new Error("静的Wasmが未設定です"); const promise = Promise.resolve(module);',
  )
  const exports = /export \{[^}]*\};\s*$/
  assert(exports.test(source), 'hash-wasmのexport形式が変わっています')
  source = source.replace(exports, 'return { argon2id };')
  // パッケージに含まれるライセンス表記と実装を生成物に保持する。
  await writeFile(resolve(generated, 'hash-wasm-factory.mjs'), `export function createStaticHashWasm(staticModules) {\n${source}\n}\n`)
}
