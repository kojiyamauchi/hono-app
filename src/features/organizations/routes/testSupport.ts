import { type Mock, mock } from 'bun:test'

/**
 * organizations Route統合テスト専用の共有準備。
 * 同じ層（features/organizations/routes）のテストだけが直接importする。
 * トップレベルでは環境変更・mock.module登録・hook登録・app importを行わず、呼び出しで状態を生成・登録・復元する。
 * context／mock群はテストファイル単位で生成し、モジュールsingletonとして共有しない。
 */

type MembersRepositoryModule = typeof import('@/features/organizations/repositories/members')
type TransferOwnershipRepositoryModule = typeof import('@/features/organizations/repositories/transferOwnership')
type AuditLogsRepositoryModule = typeof import('@/features/organizations/repositories/auditLogs')
type ProjectsRepositoryModule = typeof import('@/features/organizations/repositories/projects')
type OrganizationRepository = (typeof import('@/shared/organization/repositories'))['organizationRepository']
type MembershipRepository = (typeof import('@/shared/membership/repositories'))['membershipRepository']
type UserRepository = (typeof import('@/shared/user/repositories'))['userRepository']
type InvitationRepository = (typeof import('@/shared/invitation/repositories'))['invitationRepository']
type InvitationEmailResendRepositoryModule = typeof import('@/shared/invitation/repositories/emailResend')
type ResendModule = typeof import('@/libs/resend')

/** 実装オブジェクトの各メソッドに、同じ関数型のmockを対応させる型。名前やシグネチャのずれをtypecheckで検出する。 */
type FunctionMocks<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? Mock<(...args: A) => R> : never
}

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
  JWT_SECRET: 'test-secret',
  REFRESH_TOKEN_SECRET: 'test-refresh-secret',
  PASSWORD_RESET_TOKEN_SECRET: 'test-password-reset-secret',
  EMAIL_VERIFICATION_TOKEN_SECRET: 'test-email-verification-secret',
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
  supabase?: { supabase: object }
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
// 境界mock factory
// ---------------------------------------------------------------------------

/** 組織Repositoryのmock。 */
const createOrganizationRepositoryMock = (): MockSet<FunctionMocks<OrganizationRepository>> => {
  const mocks = {
    createWithOwner: mock<OrganizationRepository['createWithOwner']>(),
    findById: mock<OrganizationRepository['findById']>(),
    findPageByUserId: mock<OrganizationRepository['findPageByUserId']>(),
    update: mock<OrganizationRepository['update']>(),
    deleteById: mock<OrganizationRepository['deleteById']>(),
  }
  return { mocks, reset: () => resetAll(mocks) }
}

/** メンバーシップRepositoryのmock。 */
const createMembershipRepositoryMock = (): MockSet<FunctionMocks<MembershipRepository>> => {
  const mocks = {
    findByUserAndOrganization: mock<MembershipRepository['findByUserAndOrganization']>(),
    findPageByOrganization: mock<MembershipRepository['findPageByOrganization']>(),
    findById: mock<MembershipRepository['findById']>(),
    create: mock<MembershipRepository['create']>(),
    updateRole: mock<MembershipRepository['updateRole']>(),
    deleteById: mock<MembershipRepository['deleteById']>(),
  }
  return { mocks, reset: () => resetAll(mocks) }
}

/**
 * ユーザーRepositoryのmock（Routeが使うメソッドだけ）。
 * resetは認証middlewareが呼ぶexistsByIdの既定値（存在する=true）を明示的に戻す。成功/失敗のシナリオ値は各testが設定する。
 */
const createUserRepositoryMock = (): MockSet<FunctionMocks<Pick<UserRepository, 'findByEmail' | 'existsById'>>> => {
  const mocks = {
    findByEmail: mock<UserRepository['findByEmail']>(),
    existsById: mock<UserRepository['existsById']>(),
  }
  const reset = (): void => {
    resetAll(mocks)
    mocks.existsById.mockResolvedValue(true)
  }
  return { mocks, reset }
}

/** 招待Repositoryのmock（Routeが使うメソッドだけ）。 */
const createInvitationRepositoryMock = (): MockSet<
  FunctionMocks<Pick<InvitationRepository, 'findPendingByOrgAndEmail' | 'create' | 'findAllByOrganization' | 'findById' | 'cancel'>>
> => {
  const mocks = {
    findPendingByOrgAndEmail: mock<InvitationRepository['findPendingByOrgAndEmail']>(),
    create: mock<InvitationRepository['create']>(),
    findAllByOrganization: mock<InvitationRepository['findAllByOrganization']>(),
    findById: mock<InvitationRepository['findById']>(),
    cancel: mock<InvitationRepository['cancel']>(),
  }
  return { mocks, reset: () => resetAll(mocks) }
}

/** 招待メール再送Repositoryのmock。 */
const createInvitationEmailResendRepositoryMock = (): MockSet<FunctionMocks<InvitationEmailResendRepositoryModule['invitationEmailResendRepository']>> => {
  const mocks = {
    requestResend: mock<InvitationEmailResendRepositoryModule['invitationEmailResendRepository']['requestResend']>(),
  }
  return { mocks, reset: () => resetAll(mocks) }
}

/** メンバー操作Repositoryのmock。 */
const createMembersRepositoryMock = (): MockSet<FunctionMocks<MembersRepositoryModule['membersRepository']>> => {
  const mocks = {
    remove: mock<MembersRepositoryModule['membersRepository']['remove']>(),
    leave: mock<MembersRepositoryModule['membersRepository']['leave']>(),
    changeRole: mock<MembersRepositoryModule['membersRepository']['changeRole']>(),
  }
  return { mocks, reset: () => resetAll(mocks) }
}

/** オーナー権限移譲Repositoryのmock。 */
const createTransferOwnershipRepositoryMock = (): MockSet<FunctionMocks<TransferOwnershipRepositoryModule['transferOwnershipRepository']>> => {
  const mocks = { execute: mock<TransferOwnershipRepositoryModule['transferOwnershipRepository']['execute']>() }
  return { mocks, reset: () => resetAll(mocks) }
}

/** プロジェクトRepositoryのmock。 */
const createProjectsRepositoryMock = (): MockSet<FunctionMocks<ProjectsRepositoryModule['projectsRepository']>> => {
  const mocks = {
    findPage: mock<ProjectsRepositoryModule['projectsRepository']['findPage']>(),
    findByOrganizationAndId: mock<ProjectsRepositoryModule['projectsRepository']['findByOrganizationAndId']>(),
    createWithAuthorization: mock<ProjectsRepositoryModule['projectsRepository']['createWithAuthorization']>(),
    updateWithAuthorization: mock<ProjectsRepositoryModule['projectsRepository']['updateWithAuthorization']>(),
    removeWithAuthorization: mock<ProjectsRepositoryModule['projectsRepository']['removeWithAuthorization']>(),
  }
  return { mocks, reset: () => resetAll(mocks) }
}

/** 監査ログRepositoryのmock。 */
const createAuditLogsRepositoryMock = (): MockSet<FunctionMocks<AuditLogsRepositoryModule['auditLogsRepository']>> => {
  const mocks = { findPage: mock<AuditLogsRepositoryModule['auditLogsRepository']['findPage']>() }
  return { mocks, reset: () => resetAll(mocks) }
}

// ---------------------------------------------------------------------------
// Route context
// ---------------------------------------------------------------------------

type RouteTestMocks = {
  organizations: FunctionMocks<OrganizationRepository>
  memberships: FunctionMocks<MembershipRepository>
  users: FunctionMocks<Pick<UserRepository, 'findByEmail' | 'existsById'>>
  invitations: FunctionMocks<Pick<InvitationRepository, 'findPendingByOrgAndEmail' | 'create' | 'findAllByOrganization' | 'findById' | 'cancel'>>
  invitationEmailResend: FunctionMocks<InvitationEmailResendRepositoryModule['invitationEmailResendRepository']>
  members: FunctionMocks<MembersRepositoryModule['membersRepository']>
  transferOwnership: FunctionMocks<TransferOwnershipRepositoryModule['transferOwnershipRepository']>
  auditLogs: FunctionMocks<AuditLogsRepositoryModule['auditLogsRepository']>
  projects: FunctionMocks<ProjectsRepositoryModule['projectsRepository']>
}

export type RouteTestContext = {
  app: Awaited<typeof import('@/app')>['app']
  mocks: RouteTestMocks
  /** 所有するmockを初期化し、既定値を戻す。遮断stubの記録もここで初期化する（起動時の記録は生成時に検査済み）。 */
  reset: () => void
  /** 遮断した境界への呼び出しが記録されていれば失敗させる。各ファイルのafterEachで実行する。 */
  assertNoUnexpectedCalls: () => void
  /** 未検査の記録を検査し、成否にかかわらず環境値を復元する。各ファイルのafterAllで実行する。 */
  cleanup: () => void
}

/**
 * organizations Route統合テストの準備を行う。各テストファイルのトップレベルで1回だけawaitする。
 * 順序: 環境値の保存と設定 → 境界の遮断 → repository mock登録 → appのdynamic import。
 * 結果定数(*Results)は実モジュールの値をそのまま使い、Repositoryオブジェクトだけを差し替える。
 * import失敗時も変更した環境値を復元する。
 */
export const createRouteTestContext = async (options: { boundaryOverrides?: BoundaryOverrides } = {}): Promise<RouteTestContext> => {
  const environment = await startRouteTestEnvironment({ boundaryOverrides: options.boundaryOverrides })
  try {
    const organizations = createOrganizationRepositoryMock()
    const memberships = createMembershipRepositoryMock()
    const users = createUserRepositoryMock()
    const invitations = createInvitationRepositoryMock()
    const invitationEmailResend = createInvitationEmailResendRepositoryMock()
    const members = createMembersRepositoryMock()
    const transferOwnership = createTransferOwnershipRepositoryMock()
    const auditLogs = createAuditLogsRepositoryMock()
    const projects = createProjectsRepositoryMock()

    const membersModule = await import('@/features/organizations/repositories/members')
    await mock.module('@/features/organizations/repositories/members', () => ({ ...membersModule, membersRepository: members.mocks }))
    const transferOwnershipModule = await import('@/features/organizations/repositories/transferOwnership')
    await mock.module('@/features/organizations/repositories/transferOwnership', () => ({
      ...transferOwnershipModule,
      transferOwnershipRepository: transferOwnership.mocks,
    }))
    await mock.module('@/features/organizations/repositories/auditLogs', () => ({ auditLogsRepository: auditLogs.mocks }))
    const projectsModule = await import('@/features/organizations/repositories/projects')
    await mock.module('@/features/organizations/repositories/projects', () => ({ ...projectsModule, projectsRepository: projects.mocks }))
    await mock.module('@/shared/organization/repositories', () => ({ organizationRepository: organizations.mocks }))
    await mock.module('@/shared/membership/repositories', () => ({ membershipRepository: memberships.mocks }))
    await mock.module('@/shared/user/repositories', () => ({ userRepository: users.mocks }))
    await mock.module('@/shared/invitation/repositories', () => ({ invitationRepository: invitations.mocks }))
    const emailResendModule = await import('@/shared/invitation/repositories/emailResend')
    await mock.module('@/shared/invitation/repositories/emailResend', () => ({
      ...emailResendModule,
      invitationEmailResendRepository: invitationEmailResend.mocks,
    }))

    const { app } = await import('@/app')
    // 起動時の呼び出し記録をケース前のresetで消さないよう、import直後に検査する
    environment.assertNoUnexpectedCalls()

    const resets = [organizations, memberships, users, invitations, invitationEmailResend, members, transferOwnership, auditLogs, projects]
    return {
      app,
      mocks: {
        organizations: organizations.mocks,
        memberships: memberships.mocks,
        users: users.mocks,
        invitations: invitations.mocks,
        invitationEmailResend: invitationEmailResend.mocks,
        members: members.mocks,
        transferOwnership: transferOwnership.mocks,
        auditLogs: auditLogs.mocks,
        projects: projects.mocks,
      },
      reset: () => {
        for (const set of resets) set.reset()
        environment.resetUnexpectedCalls()
      },
      assertNoUnexpectedCalls: environment.assertNoUnexpectedCalls,
      cleanup: environment.cleanup,
    }
  } catch (error) {
    environment.restoreEnvironment()
    throw error
  }
}
