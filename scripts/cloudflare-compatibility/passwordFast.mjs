import simdWasm from 'argon2-browser/dist/argon2-simd.wasm'

import { createNativePasswordVerifier } from './passwordNative.mjs'

// 古い実装と同時に64MiBずつ確保しないよう、実際のWasm初期化は呼び出しまで遅延する。
export const verifyPasswordOnceFast = createNativePasswordVerifier(simdWasm)
