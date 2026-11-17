import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'

import type { Invitation } from '@/shared/invitation/entities'
import type { Membership } from '@/shared/membership/entities'
import type { AppError } from '@/utils/errors'

const findByUserAndOrganization = mock()
const findByEmail = mock()
const invitationFindPendingByOrgAndEmail = mock()
const invitationCreate = mock()
const invitationFindAllByOrganization = mock()
const invitationFindById = mock()
const invitationCancel = mock()
const getInvitationEmailConfig = mock()
const requestResend = mock()

await mock.module('@/shared/membership/repositories', () => ({
  membershipRepository: {
    findByUserAndOrganization,
  },
}))
await mock.module('@/shared/user/repositories', () => ({
  userRepository: { findByEmail },
}))
await mock.module('@/shared/invitation/services/emailConfig', () => ({ getInvitationEmailConfig }))
await mock.module('@/shared/invitation/repositories/emailResend', () => ({
  invitationEmailResendRepository: { requestResend },
  invitationEmailResendResults: { requested: 'REQUESTED', organizationNotFound: 'ORGANIZATION_NOT_FOUND', rejected: 'REJECTED' },
}))
await mock.module('@/shared/invitation/repositories', () => ({
  invitationRepository: {
    findPendingByOrgAndEmail: invitationFindPendingByOrgAndEmail,
    create: invitationCreate,
    findAllByOrganization: invitationFindAllByOrganization,
    findById: invitationFindById,
    cancel: invitationCancel,
  },
}))

const { invitationsService } = await import('../invitations')

const membership: Membership = {
  id: 10,
  userId: 2,
  organizationId: 1,
  role: 'MEMBER',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
}

const invitation: Invitation = {
  id: 20,
  organizationId: 1,
  email: 'invite@example.com',
  role: 'MEMBER',
  status: 'PENDING',
  token: 'uuid-token',
  expiresAt: new Date('2026-06-18T00:00:00.000Z'),
  createdAt: new Date('2026-06-11T00:00:00.000Z'),
}

describe('invitationsService.create', () => {
  beforeEach(() => {
    invitationFindPendingByOrgAndEmail.mockReset()
    invitationCreate.mockReset()
    getInvitationEmailConfig.mockReset()
    findByEmail.mockReset()
    findByUserAndOrganization.mockReset()
  })

  test('OWNERはMEMBER招待を作成できる', async () => {
    invitationFindPendingByOrgAndEmail.mockResolvedValue(null)
    findByEmail.mockResolvedValue(null)
    invitationCreate.mockResolvedValue(invitation)

    const result = await invitationsService.create(1, 'OWNER', { email: 'invite@example.com', role: 'MEMBER' })

    expect(result.invitationToken).toBe('uuid-token')
    expect(invitationCreate).toHaveBeenCalledWith(1, 'invite@example.com', 'MEMBER', expect.any(String), expect.any(Date), undefined)
  })

  test('配信有効時は作成時の送信設定をrepositoryに渡す', async () => {
    const delivery = { fromEmail: 'sender@example.com', scalarUrl: 'https://example.com/open-api/scalar', templateVersion: 1 }
    getInvitationEmailConfig.mockReturnValue(delivery)
    invitationFindPendingByOrgAndEmail.mockResolvedValue(null)
    findByEmail.mockResolvedValue(null)
    invitationCreate.mockResolvedValue(invitation)

    await invitationsService.create(1, 'OWNER', { email: 'invite@example.com', role: 'MEMBER' })

    expect(invitationCreate).toHaveBeenCalledWith(1, 'invite@example.com', 'MEMBER', expect.any(String), expect.any(Date), delivery)
  })

  test('配信待ちの保存失敗は機密情報をログに出さず500を返す', async () => {
    getInvitationEmailConfig.mockReturnValue({ fromEmail: 'sender@example.com', scalarUrl: 'https://example.com/open-api/scalar', templateVersion: 1 })
    invitationFindPendingByOrgAndEmail.mockResolvedValue(null)
    findByEmail.mockResolvedValue(null)
    invitationCreate.mockRejectedValue(new Error('invite@example.com private-token'))
    const log = spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await expect(invitationsService.create(1, 'OWNER', { email: 'invite@example.com', role: 'MEMBER' })).rejects.toMatchObject({
        statusCode: 500,
        message: 'サーバーエラーが発生しました',
      })
      expect(log).toHaveBeenCalledTimes(1)
      expect(log).toHaveBeenCalledWith('招待と配信待ちの保存に失敗しました', { organizationId: 1 })
    } finally {
      log.mockRestore()
    }
  })

  test('OWNERはADMIN招待を作成できる', async () => {
    invitationFindPendingByOrgAndEmail.mockResolvedValue(null)
    findByEmail.mockResolvedValue(null)
    invitationCreate.mockResolvedValue({ ...invitation, role: 'ADMIN' })

    const result = await invitationsService.create(1, 'OWNER', { email: 'invite@example.com', role: 'ADMIN' })

    expect(result.role).toBe('ADMIN')
  })

  test('ADMINはMEMBER招待を作成できる', async () => {
    invitationFindPendingByOrgAndEmail.mockResolvedValue(null)
    findByEmail.mockResolvedValue(null)
    invitationCreate.mockResolvedValue(invitation)

    const result = await invitationsService.create(1, 'ADMIN', { email: 'invite@example.com', role: 'MEMBER' })

    expect(result.role).toBe('MEMBER')
  })

  test('MEMBERは操作できず403エラーを投げる', async () => {
    await expect(invitationsService.create(1, 'MEMBER', { email: 'invite@example.com', role: 'MEMBER' })).rejects.toThrow('管理者以上')
    expect(invitationCreate).not.toHaveBeenCalled()
  })

  test('OWNERロール指定は422エラーを投げる', async () => {
    await expect(invitationsService.create(1, 'OWNER', { email: 'invite@example.com', role: 'OWNER' })).rejects.toThrow('OWNERは招待できません')
    expect(invitationCreate).not.toHaveBeenCalled()
  })

  test('ADMINがADMIN招待を作成しようとすると403エラーを投げる', async () => {
    await expect(invitationsService.create(1, 'ADMIN', { email: 'invite@example.com', role: 'ADMIN' })).rejects.toThrow('ADMINはMEMBERのみ招待')
    expect(invitationCreate).not.toHaveBeenCalled()
  })

  test('PENDING招待が既に存在する場合は409エラーを投げる', async () => {
    invitationFindPendingByOrgAndEmail.mockResolvedValue(invitation)

    await expect(invitationsService.create(1, 'OWNER', { email: 'invite@example.com', role: 'MEMBER' })).rejects.toThrow('既に作成済み')
    expect(invitationCreate).not.toHaveBeenCalled()
  })

  test('対象メールが既にメンバーの場合は409エラーを投げる', async () => {
    invitationFindPendingByOrgAndEmail.mockResolvedValue(null)
    findByEmail.mockResolvedValue({ id: 2, name: 'User', email: 'invite@example.com', password: 'hash', createdAt: new Date(), updatedAt: new Date() })
    findByUserAndOrganization.mockResolvedValue(membership)

    await expect(invitationsService.create(1, 'OWNER', { email: 'invite@example.com', role: 'MEMBER' })).rejects.toThrow('既に組織のメンバー')
    expect(invitationCreate).not.toHaveBeenCalled()
  })

  test('ユーザーが存在しない場合でも招待を作成できる（新規ユーザー向け）', async () => {
    invitationFindPendingByOrgAndEmail.mockResolvedValue(null)
    findByEmail.mockResolvedValue(null)
    invitationCreate.mockResolvedValue(invitation)

    const result = await invitationsService.create(1, 'OWNER', { email: 'newuser@example.com', role: 'MEMBER' })

    expect(result.email).toBe('invite@example.com')
    expect(findByUserAndOrganization).not.toHaveBeenCalled()
  })

  test('createがnullを返した場合（DB制約による並行重複）は409エラーを投げる', async () => {
    invitationFindPendingByOrgAndEmail.mockResolvedValue(null)
    findByEmail.mockResolvedValue(null)
    invitationCreate.mockResolvedValue(null)

    await expect(invitationsService.create(1, 'OWNER', { email: 'invite@example.com', role: 'MEMBER' })).rejects.toThrow('既に作成済み')
  })
})

describe('invitationsService.list', () => {
  beforeEach(() => {
    invitationFindAllByOrganization.mockReset()
  })

  test('OWNER/ADMINは招待一覧を取得できる', async () => {
    invitationFindAllByOrganization.mockResolvedValue([{ ...invitation, emailDelivery: null }])

    const result = await invitationsService.list(1, 'OWNER')

    expect(result).toHaveLength(1)
    expect(result[0]?.invitationToken).toBe('uuid-token')
    expect(result[0]?.emailDeliveryStatus).toBeNull()
  })

  test('ADMINも招待一覧を取得できる', async () => {
    invitationFindAllByOrganization.mockResolvedValue([{ ...invitation, emailDelivery: null }])

    const result = await invitationsService.list(1, 'ADMIN')

    expect(result).toHaveLength(1)
  })

  test('MEMBERは取得できず403エラーを投げる', async () => {
    await expect(invitationsService.list(1, 'MEMBER')).rejects.toThrow('管理者以上')
    expect(invitationFindAllByOrganization).not.toHaveBeenCalled()
  })

  test('保存済みの配信状態5種類と配信記録なし(null)をそのままemailDeliveryStatusへ写す', async () => {
    const statuses = ['PENDING', 'ACCEPTED', 'REJECTED', 'UNKNOWN', 'SKIPPED'] as const
    invitationFindAllByOrganization.mockResolvedValue([
      ...statuses.map((status, index) => ({ ...invitation, id: index + 1, emailDelivery: { status } })),
      { ...invitation, id: 99, emailDelivery: null },
    ])

    const result = await invitationsService.list(1, 'OWNER')

    expect(result.map((item) => item.emailDeliveryStatus)).toEqual([...statuses, null])
    expect(invitationFindAllByOrganization).toHaveBeenCalledWith(1)
  })

  test('配信設定や期限切れに関わらず、保存されたPENDINGを上書きせず返し、設定を参照しない', async () => {
    getInvitationEmailConfig.mockReset()
    const expired = { ...invitation, expiresAt: new Date('2000-01-01T00:00:00.000Z'), emailDelivery: { status: 'PENDING' } }
    invitationFindAllByOrganization.mockResolvedValue([expired])

    const result = await invitationsService.list(1, 'ADMIN')

    expect(result[0]?.status).toBe('PENDING')
    expect(result[0]?.emailDeliveryStatus).toBe('PENDING')
    expect(getInvitationEmailConfig).not.toHaveBeenCalled()
  })

  test('配信レコードの内部情報を含めない', async () => {
    invitationFindAllByOrganization.mockResolvedValue([
      { ...invitation, emailDelivery: { status: 'ACCEPTED', resendEmailId: 'resend-secret', lastError: 'err' } },
    ])

    const result = await invitationsService.list(1, 'OWNER')

    expect(JSON.stringify(result)).not.toContain('resend-secret')
    expect(Object.keys(result[0] ?? {})).toContain('emailDeliveryStatus')
    expect(Object.keys(result[0] ?? {})).not.toContain('emailDelivery')
  })
})

describe('invitationsService.cancel', () => {
  beforeEach(() => {
    invitationFindById.mockReset()
    invitationCancel.mockReset()
  })

  test('OWNERはMEMBER宛て招待をキャンセルできる', async () => {
    invitationFindById.mockResolvedValue(invitation)
    invitationCancel.mockResolvedValue(true)

    await invitationsService.cancel(1, 20, 'OWNER')

    expect(invitationCancel).toHaveBeenCalledWith(20)
  })

  test('OWNERはADMIN宛て招待をキャンセルできる', async () => {
    invitationFindById.mockResolvedValue({ ...invitation, role: 'ADMIN' })
    invitationCancel.mockResolvedValue(true)

    await invitationsService.cancel(1, 20, 'OWNER')

    expect(invitationCancel).toHaveBeenCalledWith(20)
  })

  test('ADMINはMEMBER宛て招待をキャンセルできる', async () => {
    invitationFindById.mockResolvedValue(invitation)
    invitationCancel.mockResolvedValue(true)

    await invitationsService.cancel(1, 20, 'ADMIN')

    expect(invitationCancel).toHaveBeenCalledWith(20)
  })

  test('cancelがfalseを返した場合（並行更新による競合）は409エラーを投げる', async () => {
    invitationFindById.mockResolvedValue(invitation)
    invitationCancel.mockResolvedValue(false)

    await expect(invitationsService.cancel(1, 20, 'OWNER')).rejects.toThrow('PENDING状態の招待のみ')
  })

  test('ADMINがADMIN宛て招待をキャンセルしようとすると403エラーを投げる', async () => {
    invitationFindById.mockResolvedValue({ ...invitation, role: 'ADMIN' })

    await expect(invitationsService.cancel(1, 20, 'ADMIN')).rejects.toThrow('ADMINはADMIN宛て')
    expect(invitationCancel).not.toHaveBeenCalled()
  })

  test('MEMBERは操作できず403エラーを投げる', async () => {
    await expect(invitationsService.cancel(1, 20, 'MEMBER')).rejects.toThrow('管理者以上')
    expect(invitationCancel).not.toHaveBeenCalled()
  })

  test('招待が存在しなければ404エラーを投げる', async () => {
    invitationFindById.mockResolvedValue(null)

    await expect(invitationsService.cancel(1, 999, 'OWNER')).rejects.toThrow('招待が見つかりません')
    expect(invitationCancel).not.toHaveBeenCalled()
  })

  test('異なる組織の招待なら404エラーを投げる', async () => {
    invitationFindById.mockResolvedValue({ ...invitation, organizationId: 99 })

    await expect(invitationsService.cancel(1, 20, 'OWNER')).rejects.toThrow('招待が見つかりません')
    expect(invitationCancel).not.toHaveBeenCalled()
  })

  test('PENDING以外の招待はキャンセルできず409エラーを投げる', async () => {
    invitationFindById.mockResolvedValue({ ...invitation, status: 'ACCEPTED' })

    await expect(invitationsService.cancel(1, 20, 'OWNER')).rejects.toThrow('PENDING状態の招待のみ')
    expect(invitationCancel).not.toHaveBeenCalled()
  })
})

describe('invitationsService.resendEmail', () => {
  const now = new Date('2026-01-01T00:00:00.000Z')
  const snapshot = { fromEmail: 'noreply@example.com', scalarUrl: 'https://example.com/open-api/scalar', templateVersion: 1 }
  const eligibleDelivery = { status: 'REJECTED', hasUnknownOutcome: false, lastError: 'client', manualResendRequestedAt: null }
  const baseState = {
    operatorRole: 'OWNER',
    invitation: { role: 'MEMBER', status: 'PENDING', expiresAt: new Date('2026-01-08T00:00:00.000Z') },
    delivery: eligibleDelivery,
    now,
  }

  type Callbacks = Record<'authorizeOperator' | 'authorizeTarget' | 'evaluate', (s: unknown) => unknown>

  /** repositoryがロック後の状態で段階ごとにコールバックを呼び、拒否で止まる動きを再現する。 */
  const mockLockedState = (state: Record<string, unknown>): void => {
    requestResend.mockImplementation(async (_input: unknown, callbacks: Callbacks) => {
      const locked = { ...baseState, ...state } as typeof baseState & { invitation: typeof baseState.invitation | null }
      const rejected = (rejection: unknown): { status: string; rejection: unknown } => ({ status: 'REJECTED', rejection })
      const operator = callbacks.authorizeOperator({ operatorRole: locked.operatorRole })
      if (operator !== null) return rejected(operator)
      const target = callbacks.authorizeTarget({ operatorRole: locked.operatorRole, invitation: locked.invitation })
      if (target !== null) return rejected(target)
      const evaluation = callbacks.evaluate({ invitation: locked.invitation, delivery: locked.delivery, now: locked.now })
      return evaluation === null ? { status: 'REQUESTED' } : rejected(evaluation)
    })
  }

  /** 操作者のロールはmiddlewareの値ではなく、ロック後の状態（mockLockedState）から決まる。 */
  const run = (): Promise<void> => invitationsService.resendEmail(1, 20, 5)

  beforeEach(() => {
    requestResend.mockReset()
    getInvitationEmailConfig.mockReset()
    getInvitationEmailConfig.mockReturnValue(snapshot)
    mockLockedState({})
  })

  test('OWNERの依頼を受け付け、操作者・招待と送信設定をrepositoryへ渡す', async () => {
    await run()

    expect(requestResend.mock.calls[0]?.[0]).toEqual({ organizationId: 1, invitationId: 20, actorUserId: 5, snapshot })
  })

  test('ADMINはMEMBER宛てを受け付けられる', async () => {
    mockLockedState({ operatorRole: 'ADMIN' })

    await run()

    expect(requestResend).toHaveBeenCalledTimes(1)
  })

  test('OWNERはADMIN宛てを受け付けられる', async () => {
    mockLockedState({ invitation: { ...baseState.invitation, role: 'ADMIN' } })

    await run()

    expect(requestResend).toHaveBeenCalledTimes(1)
  })

  test('ADMINがADMIN宛てを再送しようとすると403', async () => {
    mockLockedState({ operatorRole: 'ADMIN', invitation: { ...baseState.invitation, role: 'ADMIN' } })

    await expect(run()).rejects.toMatchObject({ statusCode: 403 })
  })

  test.each(['OWNER', 'ADMIN'])('%sでもOWNER宛ての招待（DBに行があっても）は403で保存しない', async (operatorRole) => {
    mockLockedState({ operatorRole, invitation: { ...baseState.invitation, role: 'OWNER' } })

    await expect(run()).rejects.toMatchObject({ statusCode: 403 })
  })

  test('ロール判定は引数のロールではなくロック後のDB上のロールで行い、MEMBERなら招待を見ずに403', async () => {
    mockLockedState({ operatorRole: 'MEMBER', invitation: null })

    await expect(run()).rejects.toMatchObject({ statusCode: 403, message: 'この操作には管理者以上の権限が必要です' })
  })

  test('ロック後に昇格していれば、昇格後のロールで受け付けられる', async () => {
    mockLockedState({ operatorRole: 'ADMIN' })

    await run()

    expect(requestResend).toHaveBeenCalledTimes(1)
  })

  test('operatorRoleを引数に取らず、repositoryへ操作者のロールを渡さない', async () => {
    await run()

    expect(invitationsService.resendEmail.length).toBe(3)
    expect(requestResend.mock.calls[0]?.[0]).not.toHaveProperty('operatorRole')
  })

  test('招待が存在しなければ404', async () => {
    mockLockedState({ invitation: null, delivery: null })

    await expect(run()).rejects.toMatchObject({ statusCode: 404, message: '招待が見つかりません' })
  })

  test('組織または所属がなければ404', async () => {
    requestResend.mockResolvedValue({ status: 'ORGANIZATION_NOT_FOUND' })

    await expect(run()).rejects.toMatchObject({ statusCode: 404, message: '組織が見つかりません' })
  })

  test('再送受付済みは専用メッセージの409で、設定無効・期限切れ・非PENDINGより優先する', async () => {
    getInvitationEmailConfig.mockReturnValue(undefined)
    mockLockedState({
      invitation: { ...baseState.invitation, status: 'CANCELED', expiresAt: new Date('2025-12-31T00:00:00.000Z') },
      delivery: { ...eligibleDelivery, manualResendRequestedAt: now },
    })

    await expect(run()).rejects.toMatchObject({ statusCode: 409, message: 'この招待メールの再送は既に受け付けています' })
  })

  test('再送受付済みは設定不備の500より優先する', async () => {
    getInvitationEmailConfig.mockImplementation(() => {
      throw new Error('invalid')
    })
    mockLockedState({ delivery: { ...eligibleDelivery, manualResendRequestedAt: now } })

    await expect(run()).rejects.toMatchObject({ statusCode: 409, message: 'この招待メールの再送は既に受け付けています' })
  })

  test('対象ロールの認可は再送受付済みより優先する', async () => {
    mockLockedState({
      operatorRole: 'ADMIN',
      invitation: { ...baseState.invitation, role: 'ADMIN' },
      delivery: { ...eligibleDelivery, manualResendRequestedAt: now },
    })

    await expect(run()).rejects.toMatchObject({ statusCode: 403 })
  })

  test('配信設定が無効なら409', async () => {
    getInvitationEmailConfig.mockReturnValue(undefined)

    await expect(run()).rejects.toMatchObject({ statusCode: 409, message: '招待メールの配信が有効ではありません' })
  })

  test('配信設定の不備は500でトークン等を含まないメッセージを返す', async () => {
    getInvitationEmailConfig.mockImplementation(() => {
      throw new Error('RESEND_API_KEYが必要です')
    })
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})

    await expect(run()).rejects.toMatchObject({ statusCode: 500, message: 'サーバーエラーが発生しました' })
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('RESEND_API_KEY')
    errorSpy.mockRestore()
  })

  test('設定不備でも招待が存在しなければ404を優先する', async () => {
    getInvitationEmailConfig.mockImplementation(() => {
      throw new Error('invalid')
    })
    mockLockedState({ invitation: null, delivery: null })

    await expect(run()).rejects.toMatchObject({ statusCode: 404 })
  })

  test.each(['ACCEPTED', 'EXPIRED', 'CANCELED', 'DECLINED'])('招待が%sなら409', async (status) => {
    mockLockedState({ invitation: { ...baseState.invitation, status } })

    await expect(run()).rejects.toMatchObject({ statusCode: 409, message: 'PENDING状態の招待のみメールを再送できます' })
  })

  test('期限と判定時刻が等しい場合も期限切れとして409', async () => {
    mockLockedState({ invitation: { ...baseState.invitation, expiresAt: now } })

    await expect(run()).rejects.toMatchObject({ statusCode: 409, message: '招待の有効期限が切れています' })
  })

  test('期限の1ms前は受け付ける', async () => {
    mockLockedState({ invitation: { ...baseState.invitation, expiresAt: new Date(now.getTime() + 1) } })

    await run()

    expect(requestResend).toHaveBeenCalledTimes(1)
  })

  test.each([
    ['配信行なし', null],
    ['PENDING', { ...eligibleDelivery, status: 'PENDING' }],
    ['ACCEPTED', { ...eligibleDelivery, status: 'ACCEPTED' }],
    ['受付結果不明', { ...eligibleDelivery, hasUnknownOutcome: true }],
    ['invalid_idempotency', { ...eligibleDelivery, lastError: 'invalid_idempotency' }],
    ['分類なし', { ...eligibleDelivery, lastError: null }],
  ])('再送対象外（%s）なら内部情報を含まない409', async (_name, delivery) => {
    mockLockedState({ delivery })

    const error = await run().catch((e: unknown) => e as AppError)

    expect(error).toMatchObject({ statusCode: 409, message: 'この招待メールは再送できません' })
  })

  test('rate_limitedも再送対象', async () => {
    mockLockedState({ delivery: { ...eligibleDelivery, lastError: 'rate_limited' } })

    await run()

    expect(requestResend).toHaveBeenCalledTimes(1)
  })

  test('repositoryの予期しない失敗は内部情報を含まない500にする', async () => {
    requestResend.mockRejectedValue(new Error('db secret failure'))
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})

    await expect(run()).rejects.toMatchObject({ statusCode: 500, message: 'サーバーエラーが発生しました' })
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('secret')
    errorSpy.mockRestore()
  })

  test('未知のrepository結果を成功として扱わない', async () => {
    requestResend.mockResolvedValue({ status: 'UNKNOWN' })

    await expect(run()).rejects.toThrow('結果が不明です')
  })
})
