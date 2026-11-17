import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createRouteTestContext, createSupabaseAuthMock } from './testSupport'

// context生成前の環境値。helperが既定値で上書きし、cleanupで元へ戻すことを確認する。
// （helper検証ではappを同一ファイルで複数回組み立てないため、contextはこのファイルで1回だけ生成する）
const sentinelKey = 'ENABLE_API_DOCS'
process.env[sentinelKey] = 'sentinel-before-context'

const supabaseAuth = createSupabaseAuthMock()
const context = await createRouteTestContext({ boundaryOverrides: { supabase: { supabase: { auth: supabaseAuth.mocks } } } })

beforeEach(() => {
  supabaseAuth.reset()
  context.reset()
})

afterAll(() => {
  // 未検査の記録がなければ検査に成功し、環境値を復元する
  context.cleanup()
  delete process.env[sentinelKey]
})

describe('testSupport（supabaseAuth Route用helper）', () => {
  test('SDK mockは呼び出しごとに新しく生成され、参照を共有しない', () => {
    const other = createSupabaseAuthMock()

    expect(other.mocks).not.toBe(supabaseAuth.mocks)
    expect(other.mocks.signUp).not.toBe(supabaseAuth.mocks.signUp)
  })

  test('SDK mockのresetは値・once・呼び出し履歴を初期化する', async () => {
    const { signUp, getUser } = supabaseAuth.mocks
    signUp.mockResolvedValue({ data: {}, error: null })
    getUser.mockResolvedValueOnce({ data: {}, error: null })
    await signUp({ email: 'a@example.com', password: 'password123' })

    supabaseAuth.reset()

    expect(signUp).not.toHaveBeenCalled()
    expect(signUp({ email: 'a@example.com', password: 'password123' })).toBeUndefined()
    expect(getUser('token')).toBeUndefined()
  })

  test('テスト既定の環境値を設定し、挙動フラグや接続用の値はローカル値に依存せず削除する', () => {
    expect(process.env.ALLOWED_ORIGINS).toBe('http://localhost:3000')
    expect(process.env[sentinelKey]).toBeUndefined()
    expect(process.env.SUPABASE_URL).toBeUndefined()
    expect(process.env.DATABASE_URL).toBeUndefined()
  })

  test('overrideしたsupabaseにはケース用mockが登録され、遮断記録は増えない', async () => {
    const { supabase } = (await import('@/libs/supabase')) as unknown as { supabase: { auth: typeof supabaseAuth.mocks } }

    expect(supabase.auth).toBe(supabaseAuth.mocks)
    expect(() => context.assertNoUnexpectedCalls()).not.toThrow()
  })

  test('overrideしていないprismaは任意の操作を境界名と操作名だけ記録して失敗し、resetで初期化される', async () => {
    const { prisma } = (await import('@/libs/prisma')) as unknown as {
      prisma: { $transaction: () => unknown; unknownModel: { unknownOperation: (arg: unknown) => unknown } }
    }

    expect(() => prisma.unknownModel.unknownOperation({ secret: 'value' })).toThrow('prisma.unknownModel.unknownOperation')
    expect(() => prisma.$transaction()).toThrow('prisma.$transaction')

    let message = ''
    try {
      context.assertNoUnexpectedCalls()
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('prisma.unknownModel.unknownOperation')
    expect(message).toContain('prisma.$transaction')
    // 引数（認証情報など）は記録に含めない
    expect(message).not.toContain('value')

    context.reset()
    expect(() => context.assertNoUnexpectedCalls()).not.toThrow()
  })

  test('遮断したresendは実装と同じ値exportを持ち、例外を握りつぶしても記録が残る', async () => {
    const resend = await import('@/libs/resend')

    expect(resend.resendDeliveryTimeoutMs).toBe(10_000)
    try {
      void resend.sendResendEmail({ from: 'a', to: 'b', subject: 'c', text: 'd' })
    } catch {
      // best-effort処理のように握りつぶす
    }
    expect(() => context.assertNoUnexpectedCalls()).toThrow('resend.sendResendEmail')

    context.reset()
  })

  test('cleanupは環境値を元の存在・値へ戻す（最後に実行する）', () => {
    context.cleanup()

    expect(process.env[sentinelKey]).toBe('sentinel-before-context')
  })
})
