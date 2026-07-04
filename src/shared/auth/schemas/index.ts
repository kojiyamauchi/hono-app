import { z } from 'zod'

/**
 * JWTのsubject（`sub`）に格納されるuserIdのバリデーションスキーマ。
 *
 * 許容するのは正の整数のみ。具体的には次の2形式だけを通す。
 * - `number`: 正の安全整数（`0`・負数・小数・`NaN`・安全整数の範囲外は不正）
 * - `string`: 先頭ゼロを含まない10進の正の整数表現（`/^[1-9]\d*$/`）
 *
 * `Number()` の暗黙変換に任せると `true`・配列・`"1e2"`・`"1.0"`・`"0x1"` などが
 * 正の整数として通ってしまうため、変換前の型と表現をこのスキーマで先に絞り込む。
 * 文字列は正規表現で10進整数のみに限定したうえで `number` へ変換する。
 */
export const authSubjectSchema = z.union([
  z.number().int().positive().safe(),
  z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.number().int().positive().safe()),
])

export type AuthSubjectSchemaType = z.infer<typeof authSubjectSchema>
