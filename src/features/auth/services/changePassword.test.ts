import { beforeEach, describe, expect, test } from 'bun:test'

import type { User } from '@/shared/user/entities'

import { createCredentialRepositoryMock, createUserRepositoryMock, installCredentialRepositoryMock, installUserRepositoryMock } from './testSupport'

const credentials = createCredentialRepositoryMock()
const users = createUserRepositoryMock()
await installCredentialRepositoryMock(credentials.mocks)
await installUserRepositoryMock(users.mocks)
const { changePassword } = credentials.mocks
const { findById } = users.mocks

const { changePasswordService } = await import('./changePassword')

const user: User = {
  id: 1,
  name: 'Taro',
  email: 'taro@example.com',
  password: 'hashed',
  emailVerifiedAt: null,
  createdAt: new Date('2026-06-18T00:00:00.000Z'),
  updatedAt: new Date('2026-06-18T00:00:00.000Z'),
}

beforeEach(() => {
  credentials.reset()
  users.reset()
})

describe('changePasswordService.execute', () => {
  test('現在のパスワードが正しい場合は新しいパスワードへ変更する', async () => {
    const hashed = await Bun.password.hash('current-password-123')
    findById.mockResolvedValue({ ...user, password: hashed })
    changePassword.mockResolvedValue(true)

    await expect(changePasswordService.execute(1, 'current-password-123', 'new-password-123')).resolves.toBeUndefined()

    expect(findById).toHaveBeenCalledWith(1)
    expect(changePassword).toHaveBeenCalledTimes(1)
    const [_userId, hashedPassword] = changePassword.mock.calls[0] as [number, string]
    expect(_userId).toBe(1)
    expect(hashedPassword).not.toBe('new-password-123')
    expect(hashedPassword.length).toBeGreaterThan(0)
  })

  test('現在のパスワードが誤っている場合は401エラーを投げる', async () => {
    const hashed = await Bun.password.hash('current-password-123')
    findById.mockResolvedValue({ ...user, password: hashed })

    await expect(changePasswordService.execute(1, 'wrong-password', 'new-password-123')).rejects.toMatchObject({
      statusCode: 401,
    })
    expect(changePassword).not.toHaveBeenCalled()
  })

  test('新しいパスワードが現在のパスワードと同じ場合は400エラーを投げる', async () => {
    const hashed = await Bun.password.hash('current-password-123')
    findById.mockResolvedValue({ ...user, password: hashed })

    await expect(changePasswordService.execute(1, 'current-password-123', 'current-password-123')).rejects.toMatchObject({
      statusCode: 400,
    })
    expect(changePassword).not.toHaveBeenCalled()
  })

  test('ユーザーが存在しない場合は404エラーを投げる', async () => {
    findById.mockResolvedValue(null)

    await expect(changePasswordService.execute(1, 'current-password-123', 'new-password-123')).rejects.toMatchObject({
      statusCode: 404,
    })
    expect(changePassword).not.toHaveBeenCalled()
  })

  test('永続化時に対象ユーザーが存在しなくなった場合は404エラーを投げる', async () => {
    const hashed = await Bun.password.hash('current-password-123')
    findById.mockResolvedValue({ ...user, password: hashed })
    changePassword.mockResolvedValue(false)

    await expect(changePasswordService.execute(1, 'current-password-123', 'new-password-123')).rejects.toMatchObject({
      statusCode: 404,
    })
  })
})
