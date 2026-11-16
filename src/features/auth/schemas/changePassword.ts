import { z } from 'zod'

/**
 * パスワード変更入力のバリデーションスキーマ。
 */
export const bodySchema = z
  .object({
    currentPassword: z.string().min(1, '現在のパスワードは必須です'),
    newPassword: z.string().min(8, '新しいパスワードは8文字以上で入力してください'),
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: '新しいパスワードは現在のパスワードと異なる値を入力してください',
    path: ['newPassword'],
  })

export type BodySchemaType = z.infer<typeof bodySchema>
