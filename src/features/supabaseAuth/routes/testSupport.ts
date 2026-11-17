import { type Mock, mock } from 'bun:test'

/**
 * supabaseAuth Route統合テスト専用の共有準備。
 * 同じ層（features/supabaseAuth/routes）のテストだけが直接importする。
 * トップレベルでは環境変更・mock.module登録・hook登録・app importを行わず、呼び出しで状態を生成・登録・復元する。
 * context／mock群はテストファイル単位で生成し、モジュールsingletonとして共有しない。
 */

type SupabaseAuthClient = (typeof import('@/libs/supabase'))['supabase']['auth']
type SupabaseAuthMethodName = 'signUp' | 'signInWithPassword' | 'getUser'
type ResendModule = typeof import('@/libs/resend')

/** 生成されたmock群と、そのreset。 */
type MockSet<M> = { mocks: M; reset: () => void }

/** 所有するmockの履歴・実装・once設定をすべて初期化する。 */
const resetAll = (mocks: Record<string, { mockReset: () => unknown }>): void => {
  for (const item of Object.values(mocks)) item.mockReset()
}

// ---------------------------------------------------------------------------
// 環境値
// ---------------------------------------------------------------------------

/**
 * Route統合テストの既定の環境値。undefinedはローカル.envやCI envの値に依存させないため削除する。
 * - 鍵・許可originは対象ケースが前提とするテスト値
 * - 挙動フラグ・メール送信先・Cookie属性・メールモードは未設定（アプリの既定動作）
 * - DB・Supabase・Resendの接続用値は未設定（境界は遮断stubへ差し替えるため実接続に使われない）
 */
const routeTestEnvDefaults: Record<string, string | undefined> = {
  JWT_SECRET: undefined,
  REFRESH_TOKEN_SECRET: undefined,
  PASSWORD_RESET_TOKEN_SECRET: undefined,
  EMAIL_VERIFICATION_TOKEN_SECRET: undefined,
  ALLOWED_ORIGINS: 'http://localhost:3000',
  ENABLE_INVITATION_EMAIL: undefined,
  ENABLE_API_DOCS: undefined,
  INVITATION_EMAIL_FROM: undefined,
  INVITATION_EMAIL_SCALAR_URL: undefined,
  COOKIE_SECURE: undefined,
  COOKIE_SAMESITE: undefined,
  AUTH_EMAIL_MODE: undefined,
  EMAIL_VERIFICATION_FROM_EMAIL: undefined,
  EMAIL_VERIFICATION_URL_BASE: undefined,
  PASSWORD_RESET_FROM_EMAIL: undefined,
  PASSWORD_RESET_URL_BASE: undefined,
  DATABASE_URL: undefined,
  DIRECT_URL: undefined,
  SUPABASE_URL: undefined,
  SUPABASE_PUBLISHABLE_KEY: undefined,
  SUPABASE_ANON_KEY: undefined,
  SUPABASE_SERVICE_ROLE_KEY: undefined,
  RESEND_API_KEY: undefined,
}

/** 指定した環境値を設定（undefinedは削除）し、元の存在・値へ戻す関数を返す。 */
const applyEnv = (values: Record<string, string | undefined>): (() => void) => {
  const originals = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(values)) {
    originals.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  return () => {
    for (const [key, original] of originals) {
      if (original === undefined) delete process.env[key]
      else process.env[key] = original
    }
  }
}

// ---------------------------------------------------------------------------
// インフラ境界の遮断
// ---------------------------------------------------------------------------

/**
 * ケースで境界のSDKや送信関数自体を差し替える場合だけ指定する、閉じた引数。
 * 指定した境界は遮断stubではなくこのmockを登録する（同じspecifierを1ファイルで二度登録しない）。
 * overrideのmockは呼び出し元が生成・resetし、想定する呼び出しをケースでassertする。
 */
export type BoundaryOverrides = {
  prisma?: { prisma: object }
  supabase?: { supabase: { auth: SupabaseAuthMocks } }
  resend?: Pick<ResendModule, 'sendResendEmail' | 'deliverResendEmail' | 'resendDeliveryTimeoutMs'>
}

/**
 * どの階層のプロパティアクセス・呼び出しでも、境界名と操作名だけを記録して例外を投げるProxyを作る。
 * 未知のmodel・操作でもundefined由来のTypeErrorにならず、記録が漏れない。引数や認証情報は記録しない。
 */
const createBlockedBoundary = (boundary: string, calls: string[], path: string[] = []): unknown => {
  return new Proxy(() => undefined, {
    get: (_target, property) => {
      // await時のthenable判定やSymbol参照は記録対象にしない
      if (typeof property === 'symbol' || property === 'then') return undefined
      return createBlockedBoundary(boundary, calls, [...path, property])
    },
    apply: () => {
      const operation = `${boundary}.${path.join('.')}`
      calls.push(operation)
      throw new Error(`遮断済みの境界へ想定外の呼び出しがありました: ${operation}`)
    },
  })
}

/** 呼び出しを記録して例外を投げる関数を作る。 */
const createBlockedFunction = (boundary: string, name: string, calls: string[]): (() => never) => {
  return () => {
    calls.push(`${boundary}.${name}`)
    throw new Error(`遮断済みの境界へ想定外の呼び出しがありました: ${boundary}.${name}`)
  }
}

type RouteTestEnvironment = {
  /** 遮断した境界への呼び出し記録が1件でもあれば失敗させる。 */
  assertNoUnexpectedCalls: () => void
  /** 検査済みの呼び出し記録を初期化する。 */
  resetUnexpectedCalls: () => void
  /** 未検査の記録を検査し、成否にかかわらず環境値を復元する。 */
  cleanup: () => void
}

/**
 * 環境値の保存・テスト既定値設定と、prisma・supabase・resendの遮断を行う（appはimportしない）。
 * envOverridesは既定値より優先するテスト固有値（undefinedで削除）。
 * 呼び出し側は準備の完了後にappをdynamic importし、import直後とafterEachでassertNoUnexpectedCallsを実行する。
 */
const startRouteTestEnvironment = async (
  options: {
    envOverrides?: Record<string, string | undefined>
    boundaryOverrides?: BoundaryOverrides
  } = {},
): Promise<RouteTestEnvironment & { restoreEnvironment: () => void }> => {
  const restoreEnvironment = applyEnv({ ...routeTestEnvDefaults, ...options.envOverrides })
  const calls: string[] = []
  const overrides = options.boundaryOverrides ?? {}

  const assertNoUnexpectedCalls = (): void => {
    if (calls.length === 0) return
    const summary = [...new Set(calls)].join(', ')
    throw new Error(`遮断済みの境界へ想定外の呼び出しが記録されています（${calls.length}件）: ${summary}`)
  }

  try {
    await mock.module('@/libs/prisma', () => overrides.prisma ?? { prisma: createBlockedBoundary('prisma', calls) })
    await mock.module('@/libs/supabase', () => overrides.supabase ?? { supabase: createBlockedBoundary('supabase', calls) })
    await mock.module(
      '@/libs/resend',
      () =>
        overrides.resend ?? {
          sendResendEmail: createBlockedFunction('resend', 'sendResendEmail', calls),
          deliverResendEmail: createBlockedFunction('resend', 'deliverResendEmail', calls),
          // 読み込み先が値として使うため、実装と同じ値を保持する
          resendDeliveryTimeoutMs: 10_000,
        },
    )
  } catch (error) {
    restoreEnvironment()
    throw error
  }

  return {
    assertNoUnexpectedCalls,
    resetUnexpectedCalls: () => {
      calls.length = 0
    },
    cleanup: () => {
      try {
        assertNoUnexpectedCalls()
      } finally {
        restoreEnvironment()
      }
    },
    restoreEnvironment,
  }
}

/** 起動準備だけが必要なテスト（OpenAPI定義など）向けの公開API。環境値の復元はcleanupが行う。 */
export const prepareRouteTestEnvironment = async (
  options: {
    envOverrides?: Record<string, string | undefined>
    boundaryOverrides?: BoundaryOverrides
  } = {},
): Promise<RouteTestEnvironment> => {
  const { assertNoUnexpectedCalls, resetUnexpectedCalls, cleanup } = await startRouteTestEnvironment(options)
  return { assertNoUnexpectedCalls, resetUnexpectedCalls, cleanup }
}

// ---------------------------------------------------------------------------
// Supabase SDKのケース用mock
// ---------------------------------------------------------------------------

/**
 * Supabase Auth SDKのmock。メソッド名と引数は実クライアントの型に対応させる。
 * SDKの応答型は大きく、各ケースは必要な項目だけの応答を返すため、戻り値のresolve型だけを緩める。
 */
export type SupabaseAuthMocks = {
  [K in SupabaseAuthMethodName]: Mock<(...args: Parameters<SupabaseAuthClient[K]>) => Promise<unknown>>
}

/** Supabase Auth SDKのmockを生成する。boundaryOverrides.supabaseへ渡し、呼び出し元がresetと呼び出しのassertを行う。 */
export const createSupabaseAuthMock = (): MockSet<SupabaseAuthMocks> => {
  const mocks: SupabaseAuthMocks = {
    signUp: mock<(...args: Parameters<SupabaseAuthClient['signUp']>) => Promise<unknown>>(),
    signInWithPassword: mock<(...args: Parameters<SupabaseAuthClient['signInWithPassword']>) => Promise<unknown>>(),
    getUser: mock<(...args: Parameters<SupabaseAuthClient['getUser']>) => Promise<unknown>>(),
  }
  return { mocks, reset: () => resetAll(mocks) }
}

// ---------------------------------------------------------------------------
// Route context
// ---------------------------------------------------------------------------

export type RouteTestContext = {
  app: Awaited<typeof import('@/app')>['app']
  /** supabaseAuth Routeはrepository mockを持たない。SDKのmockはboundaryOverridesで渡し、呼び出し元が所有する。 */
  mocks: Record<string, never>
  /** 遮断stubの記録を初期化する（起動時の記録は生成時に検査済み）。override したSDK mockのresetは呼び出し元が行う。 */
  reset: () => void
  /** 遮断した境界への呼び出しが記録されていれば失敗させる。各ファイルのafterEachで実行する。 */
  assertNoUnexpectedCalls: () => void
  /** 未検査の記録を検査し、成否にかかわらず環境値を復元する。各ファイルのafterAllで実行する。 */
  cleanup: () => void
}

/**
 * supabaseAuth Route統合テストの準備を行う。各テストファイルのトップレベルで1回だけawaitする。
 * 順序: 環境値の保存と設定 → 境界の遮断（overrideした境界はケース用mock）→ appのdynamic import。
 * import失敗時も変更した環境値を復元する。
 */
export const createRouteTestContext = async (options: { boundaryOverrides?: BoundaryOverrides } = {}): Promise<RouteTestContext> => {
  const environment = await startRouteTestEnvironment({ boundaryOverrides: options.boundaryOverrides })
  try {
    const { app } = await import('@/app')
    // 起動時の呼び出し記録をケース前のresetで消さないよう、import直後に検査する
    environment.assertNoUnexpectedCalls()
    return {
      app,
      mocks: {},
      reset: environment.resetUnexpectedCalls,
      assertNoUnexpectedCalls: environment.assertNoUnexpectedCalls,
      cleanup: environment.cleanup,
    }
  } catch (error) {
    environment.restoreEnvironment()
    throw error
  }
}
