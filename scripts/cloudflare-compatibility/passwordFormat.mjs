import { Buffer } from 'node:buffer'

/** 既存のBun既定値を維持し、入力のPHC文字列による計算量の増大を拒否する。 */
export const parsePasswordHash = (hash) => {
  const match = /^\$argon2id\$v=19\$m=65536,t=2,p=1\$([A-Za-z0-9+/]{43})\$([A-Za-z0-9+/]{43})$/.exec(hash)
  if (!match) throw new Error('検証対象外のハッシュ形式です')
  return { salt: Buffer.from(match[1], 'base64'), expected: Buffer.from(match[2], 'base64') }
}

/** 計測に使う入力を制限し、両実装へ同じ条件を適用する。 */
export const validatePasswordVerification = ({ password, bunHash }) => {
  if (typeof password !== 'string' || password.length > 1024 || typeof bunHash !== 'string') throw new Error('不正な検証入力です')
  return parsePasswordHash(bunHash)
}
