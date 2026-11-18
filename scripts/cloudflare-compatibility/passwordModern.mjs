import argon2Module from './.wrangler/hash-argon2.wasm'
import blake2bModule from './.wrangler/hash-blake2b.wasm'
import { createStaticHashWasm } from './.wrangler/hash-wasm-factory.mjs'
import { createModernPasswordHasher } from './passwordModernVerifier.mjs'

const { argon2id } = createStaticHashWasm({ argon2: argon2Module, blake2b: blake2bModule })

const hasher = createModernPasswordHasher(argon2id)

export const verifyPasswordOnceModern = hasher.verify
export const checkPasswordCompatibilityModern = hasher.check
