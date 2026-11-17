import { type Mock, mock } from 'bun:test'

/**
 * invitations Serviceテスト専用の共有準備。
 * 同じ層（features/invitations/services）のテストだけが直接importする。
 * トップレベルでは環境変更・mock.module登録・hook登録を行わず、呼び出しで状態を生成・登録・復元する。
 * mock群はテストファイル単位で生成し、モジュールsingletonとして共有しない。
 */

type RefreshTokenRepository = (typeof import('@/shared/auth/repositories/refreshToken'))['refreshTokenRepository']
type EmailVerificationTokenRepository = (typeof import('@/shared/auth/repositories/emailVerification'))['emailVerificationTokenRepository']
type InvitationRepository = (typeof import('@/shared/invitation/repositories'))['invitationRepository']
type MembershipRepository = (typeof import('@/shared/membership/repositories'))['membershipRepository']
type UserRepository = (typeof import('@/shared/user/repositories'))['userRepository']
type EmailVerificationServiceModule = typeof import('@/shared/auth/services/emailVerification')

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

/**
 * 指定した環境値をテスト値へ設定し、元の存在・値へ戻す関数を返す。
 * undefinedを渡した値は削除する（ローカル.envの値に依存させないため）。
 */
export const setTestEnv = (values: Record<string, string | undefined>): { restore: () => void } => {
  const originals = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(values)) {
    originals.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  return {
    restore: () => {
      for (const [key, original] of originals) {
        if (original === undefined) delete process.env[key]
        else process.env[key] = original
      }
    },
  }
}

type InvitationMethods = Pick<InvitationRepository, 'findByToken' | 'findByTokenWithOrganization' | 'markExpired' | 'accept' | 'decline' | 'signup'>
type MembershipMethods = Pick<MembershipRepository, 'findByUserAndOrganization'>
type UserMethods = Pick<UserRepository, 'findById' | 'findByEmail'>
type RefreshTokenMethods = Pick<RefreshTokenRepository, 'create'>
type EmailVerificationTokenMethods = Pick<EmailVerificationTokenRepository, 'create' | 'deleteByIdAndTokenHash'>

/** 招待Repositoryのmockを生成する。 */
export const createInvitationRepositoryMock = (): MockSet<FunctionMocks<InvitationMethods>> => {
  const mocks = {
    findByToken: mock<InvitationRepository['findByToken']>(),
    findByTokenWithOrganization: mock<InvitationRepository['findByTokenWithOrganization']>(),
    markExpired: mock<InvitationRepository['markExpired']>(),
    accept: mock<InvitationRepository['accept']>(),
    decline: mock<InvitationRepository['decline']>(),
    signup: mock<InvitationRepository['signup']>(),
  }
  return { mocks, reset: () => resetAll(mocks) }
}

/** 招待Repositoryのmockをモジュールへ登録する。 */
export const installInvitationRepositoryMock = async (mocks: FunctionMocks<InvitationMethods>): Promise<void> => {
  await mock.module('@/shared/invitation/repositories', () => ({ invitationRepository: mocks }))
}

/** メンバーシップRepositoryのmockを生成する。 */
export const createMembershipRepositoryMock = (): MockSet<FunctionMocks<MembershipMethods>> => {
  const mocks = { findByUserAndOrganization: mock<MembershipRepository['findByUserAndOrganization']>() }
  return { mocks, reset: () => resetAll(mocks) }
}

/** メンバーシップRepositoryのmockをモジュールへ登録する。 */
export const installMembershipRepositoryMock = async (mocks: FunctionMocks<MembershipMethods>): Promise<void> => {
  await mock.module('@/shared/membership/repositories', () => ({ membershipRepository: mocks }))
}

/** ユーザーRepositoryのmockを生成する。 */
export const createUserRepositoryMock = (): MockSet<FunctionMocks<UserMethods>> => {
  const mocks = {
    findById: mock<UserRepository['findById']>(),
    findByEmail: mock<UserRepository['findByEmail']>(),
  }
  return { mocks, reset: () => resetAll(mocks) }
}

/** ユーザーRepositoryのmockをモジュールへ登録する。 */
export const installUserRepositoryMock = async (mocks: FunctionMocks<UserMethods>): Promise<void> => {
  await mock.module('@/shared/user/repositories', () => ({ userRepository: mocks }))
}

/** リフレッシュトークンRepositoryのmockを生成する。 */
export const createRefreshTokenRepositoryMock = (): MockSet<FunctionMocks<RefreshTokenMethods>> => {
  const mocks = { create: mock<RefreshTokenRepository['create']>() }
  return { mocks, reset: () => resetAll(mocks) }
}

/** リフレッシュトークンRepositoryのmockをモジュールへ登録する。 */
export const installRefreshTokenRepositoryMock = async (mocks: FunctionMocks<RefreshTokenMethods>): Promise<void> => {
  await mock.module('@/shared/auth/repositories/refreshToken', () => ({ refreshTokenRepository: mocks }))
}

/** メール検証トークンRepositoryのmockを生成する。 */
export const createEmailVerificationTokenRepositoryMock = (): MockSet<FunctionMocks<EmailVerificationTokenMethods>> => {
  const mocks = {
    create: mock<EmailVerificationTokenRepository['create']>(),
    deleteByIdAndTokenHash: mock<EmailVerificationTokenRepository['deleteByIdAndTokenHash']>(),
  }
  return { mocks, reset: () => resetAll(mocks) }
}

/** メール検証トークンRepositoryのmockをモジュールへ登録する。 */
export const installEmailVerificationTokenRepositoryMock = async (mocks: FunctionMocks<EmailVerificationTokenMethods>): Promise<void> => {
  await mock.module('@/shared/auth/repositories/emailVerification', () => ({ emailVerificationTokenRepository: mocks }))
}

/** メール検証の通知起動(best-effort)のmockを生成する。 */
export const createEmailVerificationServiceMock = (): MockSet<FunctionMocks<Pick<EmailVerificationServiceModule, 'sendEmailVerificationBestEffort'>>> => {
  const mocks = { sendEmailVerificationBestEffort: mock<EmailVerificationServiceModule['sendEmailVerificationBestEffort']>() }
  return { mocks, reset: () => resetAll(mocks) }
}

/**
 * shared/auth/services/emailVerificationの実装関数はそのまま使い、sendEmailVerificationBestEffortだけ差し替える。
 * 実モジュールを読み込むため、依存するメール検証トークンRepositoryのmock登録を先に行うこと。
 */
export const installEmailVerificationServiceMock = async (
  mocks: FunctionMocks<Pick<EmailVerificationServiceModule, 'sendEmailVerificationBestEffort'>>,
): Promise<void> => {
  const actual = await import('@/shared/auth/services/emailVerification')
  await mock.module('@/shared/auth/services/emailVerification', () => ({ ...actual, ...mocks }))
}
