import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createRefreshTokenFixture, createRouteTestContext, createUserFixture } from './testSupport'

// context生成前の環境値。helperが既定値で上書きし、cleanupで元へ戻すことを確認する。
// （helper検証ではappを同一ファイルで複数回組み立てないため、contextはこのファイルで1回だけ生成する）
const sentinelKey = 'COOKIE_SECURE'
const jwtSecretBefore = process.env.JWT_SECRET
process.env[sentinelKey] = 'sentinel-before-context'

const context = await createRouteTestContext()

beforeEach(() => {
  context.reset()
})

afterAll(() => {
  // 未検査の記録がなければ検査に成功し、環境値を復元する
  context.cleanup()
  // cleanupは環境値を元の存在・値へ戻す（テスト順に依存しないようafterAllで検証する）
  expect(process.env[sentinelKey]).toBe('sentinel-before-context')
  expect(process.env.JWT_SECRET).toBe(jwtSecretBefore)
  delete process.env[sentinelKey]
})

describe('testSupport（auth Route用helper）', () => {
  test('テスト既定の環境値を設定し、挙動フラグや接続用の値はローカル値に依存せず削除する', () => {
    expect(process.env.JWT_SECRET).toBe('test-secret')
    expect(process.env.ALLOWED_ORIGINS).toBe('http://localhost:3000')
    expect(process.env[sentinelKey]).toBeUndefined()
    expect(process.env.DATABASE_URL).toBeUndefined()
    expect(process.env.ENABLE_INVITATION_EMAIL).toBeUndefined()
  })

  test('mocksは境界ごとに名前付きでまとまり、resetで履歴・値・onceを初期化する', async () => {
    const { users, refreshTokens } = context.mocks
    users.findById.mockResolvedValue(null)
    users.findByEmail.mockResolvedValueOnce(null)
    refreshTokens.revokeFamily.mockResolvedValue(1)
    await users.findById(1)

    context.reset()

    expect(users.findById).not.toHaveBeenCalled()
    expect(users.findById(1)).toBeUndefined()
    expect(users.findByEmail('a@example.com')).toBeUndefined()
    expect(refreshTokens.revokeFamily('f')).toBeUndefined()
  })

  test('resetは認証middlewareが使うexistsByIdの既定値（存在する）を戻す', async () => {
    context.mocks.users.existsById.mockResolvedValue(false)

    context.reset()

    await expect(context.mocks.users.existsById(1)).resolves.toBe(true)
  })

  test('resetはパスワードリセット待機時間の既定値（0ms）を戻す', () => {
    const { passwordResetRequestDelayMs } = context.mocks.passwordResetDelay
    passwordResetRequestDelayMs.mockReturnValue(500)

    context.reset()

    expect(passwordResetRequestDelayMs(0)).toBe(0)
  })

  test('fixtureは呼び出しごとに独立したobjectとDateを返し、overridesを反映する', () => {
    const first = createUserFixture()
    const second = createUserFixture({ id: 2 })
    first.name = 'Changed'

    expect(second.name).toBe('Taro')
    expect(second.id).toBe(2)
    expect(first.createdAt).not.toBe(second.createdAt)
    expect(createRefreshTokenFixture().expiresAt).not.toBe(createRefreshTokenFixture().expiresAt)
    expect(createRefreshTokenFixture({ revokedAt: new Date(0) }).revokedAt).toEqual(new Date(0))
  })

  test('遮断したprismaへの任意のmodel・操作・$transactionは境界名と操作名だけを記録して失敗する', async () => {
    const { prisma } = (await import('@/libs/prisma')) as unknown as {
      prisma: { $transaction: () => unknown; unknownModel: { unknownOperation: (arg: unknown) => unknown } }
    }

    try {
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
    } finally {
      // assertが失敗しても遮断の記録を残さない
      context.reset()
    }
  })

  test('例外を握りつぶす呼び出し側でも記録が残り、resetで初期化される', async () => {
    const { supabase } = (await import('@/libs/supabase')) as unknown as { supabase: { auth: { getUser: () => unknown } } }

    try {
      // best-effort処理のように例外を捕捉してもassertNoUnexpectedCallsは失敗する
      try {
        supabase.auth.getUser()
      } catch {
        // 握りつぶす
      }
      expect(() => context.assertNoUnexpectedCalls()).toThrow('supabase.auth.getUser')

      context.reset()

      expect(() => context.assertNoUnexpectedCalls()).not.toThrow()
    } finally {
      // assertが失敗しても遮断の記録を残さない
      context.reset()
    }
  })

  test('遮断したresendは実装と同じ値exportを持ち、送信関数は記録して失敗する', async () => {
    const resend = await import('@/libs/resend')

    try {
      expect(resend.resendDeliveryTimeoutMs).toBe(10_000)
      expect(() => resend.sendResendEmail({ from: 'a', to: 'b', subject: 'c', text: 'd' })).toThrow('resend.sendResendEmail')
      expect(() => resend.deliverResendEmail({ from: 'a', to: 'b', subject: 'c', text: 'd' }, 'key')).toThrow('resend.deliverResendEmail')
      expect(() => context.assertNoUnexpectedCalls()).toThrow('resend.deliverResendEmail')

      context.reset()
    } finally {
      // assertが失敗しても遮断の記録を残さない
      context.reset()
    }
  })
})
