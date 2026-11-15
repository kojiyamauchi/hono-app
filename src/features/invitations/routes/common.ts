import { errorResponseDto } from '@/shared/openApi/dtos'
import { SECURITY_SCHEME } from '@/shared/openApi/schemes'

/** JSONエラーレスポンス（`{ error: { message } }`）の共通定義を生成する。 */
export const errorResponse = (description: string): { content: { 'application/json': { schema: typeof errorResponseDto } }; description: string } => ({
  content: { 'application/json': { schema: errorResponseDto } },
  description,
})

/** アクセストークン（Authorization: Bearer）を要求するendpoint用のsecurity。 */
export const bearerSecurity = [{ [SECURITY_SCHEME.bearer]: [] }]
