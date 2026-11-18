import { validatePasswordVerification } from './passwordFormat.mjs'

/** 静的コンパイル済みのargon2-browser 1.18.0を使い、計算全体をWasm側で実行する。 */
export const createNativePasswordVerifier = (wasmModule) => {
  let instance
  let memory
  const initialize = () => {
    if (instance) return instance.exports
    const candidate = new WebAssembly.Instance(wasmModule, {
      a: {
        // 固定したEmscriptenバイナリが必要とするメモリ操作だけを提供する。
        a: (destination, source, size) => {
          new Uint8Array(memory.buffer).copyWithin(destination, source, source + size)
          return destination
        },
        b: (requested) => {
          // Argon2の設定は64MiBのまま、ランタイムを含めた確保には80MiBの上限を設ける。
          if (requested > 80 * 1024 * 1024) return 0
          try {
            memory.grow(Math.ceil((requested - memory.buffer.byteLength) / 65536))
            return 1
          } catch {
            return 0
          }
        },
      },
    })
    try {
      memory = candidate.exports.c
      if (!(memory instanceof WebAssembly.Memory) || typeof candidate.exports.m !== 'function') throw new Error('固定したWasmのインターフェースが異なります')
      candidate.exports.d()
      // 検査と初期化が完了したインスタンスだけを、次のリクエストで再利用する。
      instance = candidate
      return instance.exports
    } catch (error) {
      memory = undefined
      throw error
    }
  }
  return ({ password, bunHash }) => {
    validatePasswordVerification({ password, bunHash })
    const wasm = initialize()
    const passwordBytes = new TextEncoder().encode(password)
    const encodedBytes = new TextEncoder().encode(bunHash)
    let passwordPointer = 0
    let encodedPointer = 0
    try {
      passwordPointer = wasm.f(passwordBytes.length + 1)
      encodedPointer = wasm.f(encodedBytes.length + 1)
      if (!passwordPointer || !encodedPointer) throw new Error('Argon2のメモリ確保に失敗しました')
      const bytes = new Uint8Array(memory.buffer)
      bytes.set(passwordBytes, passwordPointer)
      bytes[passwordPointer + passwordBytes.length] = 0
      bytes.set(encodedBytes, encodedPointer)
      bytes[encodedPointer + encodedBytes.length] = 0
      // 文字列長を明示してNUL文字も保持し、ライブラリ側の定時間比較で検証する。
      const result = wasm.m(encodedPointer, passwordPointer, passwordBytes.length, 0, 0, 0, 0, 2)
      if (result !== 0 && result !== -35) throw new Error(`Argon2の計算に失敗しました (${result})`)
      return result === 0
    } catch (error) {
      // 中断などで状態が不正になったインスタンスを、次のリクエストへ再利用しない。
      instance = undefined
      throw error
    } finally {
      // Wasmの計算中にmemoryが拡張され得るため、解放前にviewを取り直す。
      const bytes = new Uint8Array(memory.buffer)
      try {
        if (passwordPointer) {
          bytes.fill(0, passwordPointer, passwordPointer + passwordBytes.length + 1)
          wasm.g(passwordPointer)
        }
        if (encodedPointer) {
          bytes.fill(0, encodedPointer, encodedPointer + encodedBytes.length + 1)
          wasm.g(encodedPointer)
        }
      } finally {
        passwordBytes.fill(0)
        if (!instance) memory = undefined
      }
    }
  }
}
