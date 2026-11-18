/** Wranglerが静的にコンパイルして配備するWasmモジュール。 */
declare module '*.wasm' {
  const module: WebAssembly.Module
  export default module
}

/** 固定版argon2idのWasm初期化境界。 */
declare module 'argon2id/lib/setup.js' {
  const setup: (
    simd: (imports: WebAssembly.Imports) => { instance: WebAssembly.Instance },
    fallback: (imports: WebAssembly.Imports) => { instance: WebAssembly.Instance },
  ) => Promise<unknown>
  export default setup
}
