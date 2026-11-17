import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import type { RouteTestContext } from './testSupport'
import { createRouteTestContext } from './testSupport'

// helperが既定値で上書きする環境値の復元は、helperのcleanupの責務。
// 一方、このテスト自身が設定する環境値（sentinel）は、元の存在・値を保存してfinallyで戻す責務をテスト側が持つ。
// （helper検証ではappを同一ファイルで複数回組み立てないため、contextはこのファイルで1回だけ生成する）
const sentinelKey = 'ENABLE_API_DOCS'
const originalTestOwnedEnv = new Map([[sentinelKey, process.env[sentinelKey]]])
const restoreTestOwnedEnv = (): void => {
  for (const [key, original] of originalTestOwnedEnv) {
    if (original === undefined) delete process.env[key]
    else process.env[key] = original
  }
}
const jwtSecretBefore = process.env.JWT_SECRET
process.env[sentinelKey] = 'sentinel-before-context'

let context: RouteTestContext
try {
  context = await createRouteTestContext()
} catch (error) {
  // context生成に失敗してもテスト側が変更した環境値を戻す
  restoreTestOwnedEnv()
  throw error
}

beforeEach(() => {
  context.reset()
})

afterAll(() => {
  try {
    // 未検査の記録がなければ検査に成功し、helperが環境値を復元する
    context.cleanup()
    // cleanupは環境値を元の存在・値へ戻す（テスト順に依存しないようafterAllで検証する）
    expect(process.env[sentinelKey]).toBe('sentinel-before-context')
    expect(process.env.JWT_SECRET).toBe(jwtSecretBefore)
  } finally {
    // cleanupや復元assertが失敗しても、テスト側が変更した環境値を元の存在・値へ戻す
    restoreTestOwnedEnv()
  }
})

describe('testSupport（users Route用helper）', () => {
  test('テスト既定の環境値を設定し、挙動フラグや接続用の値はローカル値に依存せず削除する', () => {
    expect(process.env.JWT_SECRET).toBe('test-secret')
    expect(process.env.ALLOWED_ORIGINS).toBe('http://localhost:3000')
    expect(process.env[sentinelKey]).toBeUndefined()
    expect(process.env.DATABASE_URL).toBeUndefined()
    expect(process.env.ENABLE_INVITATION_EMAIL).toBeUndefined()
  })

  test('mocksは境界ごとに名前付きでまとまり、resetで履歴・値・onceを初期化する', async () => {
    const { users, me } = context.mocks
    users.findById.mockResolvedValue(null)
    users.findByEmail.mockResolvedValueOnce(null)
    me.remove.mockResolvedValue('DELETED')
    await users.findById(1)

    context.reset()

    expect(users.findById).not.toHaveBeenCalled()
    expect(users.findById(1)).toBeUndefined()
    expect(users.findByEmail('a@example.com')).toBeUndefined()
    expect(me.remove(1, async () => true)).toBeUndefined()
  })

  test('resetは認証middlewareが使うexistsByIdの既定値（存在する）を戻す', async () => {
    context.mocks.users.existsById.mockResolvedValue(false)

    context.reset()

    await expect(context.mocks.users.existsById(1)).resolves.toBe(true)
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
