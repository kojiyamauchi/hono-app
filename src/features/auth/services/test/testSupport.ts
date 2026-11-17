import { type Mock, mock } from 'bun:test'

/**
 * auth Serviceテスト専用の共有準備。
 * 同じ層（features/auth/services）のテストだけが直接importする。
 * トップレベルでは環境変更・mock.module登録・hook登録を行わず、呼び出しで状態を生成・登録・復元する。
 * mock群はテストファイル単位で生成し、モジュールsingletonとして共有しない。
 */

type RefreshTokenRepository = (typeof import('@/shared/auth/repositories/refreshToken'))['refreshTokenRepository']
type CredentialRepository = (typeof import('@/shared/auth/repositories/credential'))['authCredentialRepository']
type PasswordResetTokenRepository = (typeof import('@/shared/auth/repositories/passwordReset'))['passwordResetTokenRepository']
type EmailVerificationTokenRepository = (typeof import('@/shared/auth/repositories/emailVerification'))['emailVerificationTokenRepository']
type UserRepository = (typeof import('@/shared/user/repositories'))['userRepository']
type EmailVerificationServiceModule = typeof import('@/shared/auth/services/emailVerification')
type PasswordResetServiceModule = typeof import('@/shared/auth/services/passwordReset')
type TimingModule = typeof import('@/utils/timing')

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

/** リフレッシュトークンRepositoryのmockを生成する。 */
export const createRefreshTokenRepositoryMock = (): MockSet<FunctionMocks<RefreshTokenRepository>> => {
  const mocks = {
    create: mock<RefreshTokenRepository['create']>(),
    findByTokenHash: mock<RefreshTokenRepository['findByTokenHash']>(),
    revokeById: mock<RefreshTokenRepository['revokeById']>(),
    revokeFamily: mock<RefreshTokenRepository['revokeFamily']>(),
    revokeByUserIdAndFamilyId: mock<RefreshTokenRepository['revokeByUserIdAndFamilyId']>(),
    rotate: mock<RefreshTokenRepository['rotate']>(),
    findActiveSessionsByUserId: mock<RefreshTokenRepository['findActiveSessionsByUserId']>(),
    revokeAllByUserId: mock<RefreshTokenRepository['revokeAllByUserId']>(),
  }
  return { mocks, reset: () => resetAll(mocks) }
}

/** リフレッシュトークンRepositoryのmockをモジュールへ登録する。 */
export const installRefreshTokenRepositoryMock = async (mocks: ReturnType<typeof createRefreshTokenRepositoryMock>['mocks']): Promise<void> => {
  await mock.module('@/shared/auth/repositories/refreshToken', () => ({ refreshTokenRepository: mocks }))
}

/** 認証情報Repositoryのmockを生成する。 */
export const createCredentialRepositoryMock = (): MockSet<FunctionMocks<CredentialRepository>> => {
  const mocks = {
    changePassword: mock<CredentialRepository['changePassword']>(),
  }
  return { mocks, reset: () => resetAll(mocks) }
}

/** 認証情報Repositoryのmockをモジュールへ登録する。 */
export const installCredentialRepositoryMock = async (mocks: ReturnType<typeof createCredentialRepositoryMock>['mocks']): Promise<void> => {
  await mock.module('@/shared/auth/repositories/credential', () => ({ authCredentialRepository: mocks }))
}

/** パスワードリセットトークンRepositoryのmockを生成する。 */
export const createPasswordResetTokenRepositoryMock = (): MockSet<FunctionMocks<PasswordResetTokenRepository>> => {
  const mocks = {
    create: mock<PasswordResetTokenRepository['create']>(),
    findByTokenHash: mock<PasswordResetTokenRepository['findByTokenHash']>(),
    deleteByIdAndTokenHash: mock<PasswordResetTokenRepository['deleteByIdAndTokenHash']>(),
    confirm: mock<PasswordResetTokenRepository['confirm']>(),
  }
  return { mocks, reset: () => resetAll(mocks) }
}

/** パスワードリセットトークンRepositoryのmockをモジュールへ登録する。 */
export const installPasswordResetTokenRepositoryMock = async (mocks: ReturnType<typeof createPasswordResetTokenRepositoryMock>['mocks']): Promise<void> => {
  await mock.module('@/shared/auth/repositories/passwordReset', () => ({ passwordResetTokenRepository: mocks }))
}

/** メール検証トークンRepositoryのmockを生成する。 */
export const createEmailVerificationTokenRepositoryMock = (): MockSet<FunctionMocks<EmailVerificationTokenRepository>> => {
  const mocks = {
    create: mock<EmailVerificationTokenRepository['create']>(),
    findByTokenHash: mock<EmailVerificationTokenRepository['findByTokenHash']>(),
    deleteByIdAndTokenHash: mock<EmailVerificationTokenRepository['deleteByIdAndTokenHash']>(),
    confirm: mock<EmailVerificationTokenRepository['confirm']>(),
  }
  return { mocks, reset: () => resetAll(mocks) }
}

/** メール検証トークンRepositoryのmockをモジュールへ登録する。 */
export const installEmailVerificationTokenRepositoryMock = async (
  mocks: ReturnType<typeof createEmailVerificationTokenRepositoryMock>['mocks'],
): Promise<void> => {
  await mock.module('@/shared/auth/repositories/emailVerification', () => ({ emailVerificationTokenRepository: mocks }))
}

/** ユーザーRepositoryのmockを生成する。 */
export const createUserRepositoryMock = (): MockSet<FunctionMocks<UserRepository>> => {
  const mocks = {
    findByEmail: mock<UserRepository['findByEmail']>(),
    findById: mock<UserRepository['findById']>(),
    existsById: mock<UserRepository['existsById']>(),
    create: mock<UserRepository['create']>(),
    updateById: mock<UserRepository['updateById']>(),
  }
  return { mocks, reset: () => resetAll(mocks) }
}

/** ユーザーRepositoryのmockをモジュールへ登録する。 */
export const installUserRepositoryMock = async (mocks: ReturnType<typeof createUserRepositoryMock>['mocks']): Promise<void> => {
  await mock.module('@/shared/user/repositories', () => ({ userRepository: mocks }))
}

/** メール検証の通知起動(best-effort)のmockを生成する。 */
export const createEmailVerificationServiceMock = (): MockSet<FunctionMocks<Pick<EmailVerificationServiceModule, 'sendEmailVerificationBestEffort'>>> => {
  const mocks = {
    sendEmailVerificationBestEffort: mock<EmailVerificationServiceModule['sendEmailVerificationBestEffort']>(),
  }
  return { mocks, reset: () => resetAll(mocks) }
}

/**
 * shared/auth/services/emailVerificationの実装関数はそのまま使い、sendEmailVerificationBestEffortだけ差し替える。
 * 実モジュールを読み込むため、依存するRepositoryのmock登録を先に行うこと。
 */
export const installEmailVerificationServiceMock = async (mocks: ReturnType<typeof createEmailVerificationServiceMock>['mocks']): Promise<void> => {
  const actual = await import('@/shared/auth/services/emailVerification')
  await mock.module('@/shared/auth/services/emailVerification', () => ({ ...actual, ...mocks }))
}

/** パスワードリセット通知(notifier)のmockを生成する。 */
export const createPasswordResetNotifierMock = (): MockSet<FunctionMocks<PasswordResetServiceModule['passwordResetNotifier']>> => {
  const mocks = {
    send: mock<PasswordResetServiceModule['passwordResetNotifier']['send']>(),
  }
  return { mocks, reset: () => resetAll(mocks) }
}

/** shared/auth/services/passwordResetの実装関数はそのまま使い、passwordResetNotifierだけ差し替える。 */
export const installPasswordResetNotifierMock = async (mocks: ReturnType<typeof createPasswordResetNotifierMock>['mocks']): Promise<void> => {
  const actual = await import('@/shared/auth/services/passwordReset')
  await mock.module('@/shared/auth/services/passwordReset', () => ({ ...actual, passwordResetNotifier: mocks }))
}

/**
 * パスワードリセット要求の待機時間のmockを生成する。
 * resetは既定値（待機0ms）へ戻す。mockResetだけだと実装が消えて戻り値がundefinedになるため。
 */
export const createPasswordResetDelayMock = (): MockSet<FunctionMocks<Pick<TimingModule, 'passwordResetRequestDelayMs'>>> => {
  const passwordResetRequestDelayMs = mock<TimingModule['passwordResetRequestDelayMs']>(() => 0)
  return {
    mocks: { passwordResetRequestDelayMs },
    reset: () => {
      passwordResetRequestDelayMs.mockReset()
      passwordResetRequestDelayMs.mockImplementation(() => 0)
    },
  }
}

/** 待機時間のmockをモジュールへ登録する。 */
export const installPasswordResetDelayMock = async (mocks: ReturnType<typeof createPasswordResetDelayMock>['mocks']): Promise<void> => {
  await mock.module('@/utils/timing', () => mocks)
}
