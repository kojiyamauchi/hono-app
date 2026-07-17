import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { sign } from 'hono/jwt'

import type { User } from '@/shared/user/entities'

process.env.JWT_SECRET = 'test-secret'

const findById = mock()
const updateById = mock()
const findByEmail = mock()
const create = mock()
const deleteAccount = mock()
const existsById = mock()

await mock.module('@/shared/user/repositories', () => ({
  userRepository: { findById, updateById, findByEmail, create, existsById },
}))

await mock.module('@/features/users/repositories', () => ({
  accountDeletionRepository: { deleteAccount },
  accountDeletionResults: {
    deleted: 'DELETED',
    notFound: 'NOT_FOUND',
    invalidPassword: 'INVALID_PASSWORD',
    soleOwner: 'SOLE_OWNER',
  },
}))

const { app } = await import('@/app')

const user: User = {
  id: 1,
  name: 'Taro',
  email: 'taro@example.com',
  password: 'hashed-password',
  emailVerifiedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
}

const createToken = async (userId: number): Promise<string> => {
  return sign(
    {
      sub: userId,
      exp: Math.floor(Date.now() / 1000) + 60,
    },
    'test-secret',
  )
}

describe('users routes', () => {
  beforeEach(() => {
    findById.mockReset()
    updateById.mockReset()
    findByEmail.mockReset()
    create.mockReset()
    deleteAccount.mockReset()
    existsById.mockReset()
    existsById.mockResolvedValue(true)
  })

  test('GET /users/me は認証済みユーザー自身の詳細情報を返す', async () => {
    findById.mockResolvedValue(user)
    const token = await createToken(1)

    const response = await app.request('/users/me', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.id).toBe(1)
    expect(body.name).toBe('Taro')
    expect(body.email).toBe('taro@example.com')
    expect(body.emailVerified).toBe(false)
    expect(body).not.toHaveProperty('password')
  })

  test('PATCH /users/me は認証済みユーザー自身の名前を更新する', async () => {
    findById.mockResolvedValue(user)
    updateById.mockResolvedValue({ ...user, name: 'Updated User' })
    const token = await createToken(1)

    const response = await app.request('/users/me', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Updated User' }),
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(updateById).toHaveBeenCalledWith(1, { name: 'Updated User' })
    expect(body.name).toBe('Updated User')
    expect(body.email).toBe('taro@example.com')
    expect(body.emailVerified).toBe(false)
    expect(body).not.toHaveProperty('password')
  })

  test('PATCH /users/me は更新時にユーザーが存在しなくなったら404を返す', async () => {
    findById.mockResolvedValue(user)
    updateById.mockResolvedValue(null)
    const token = await createToken(1)

    const response = await app.request('/users/me', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Updated User' }),
    })

    expect(response.status).toBe(404)
    const body = (await response.json()) as { error?: { message?: string } }
    expect(body.error?.message).toBe('ユーザーが見つかりません')
  })

  test('PATCH /users/me はbodyなし（Content-Typeなし）でも入力不正として400を返す', async () => {
    const token = await createToken(1)

    const response = await app.request('/users/me', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    })

    // 必須bodyの検証がスキップされず、既存の統一エラー形式で400になること
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error?: { message?: string } }
    expect(body.error?.message).toBeDefined()
    // 検証で止まるため更新処理は呼ばれない
    expect(updateById).not.toHaveBeenCalled()
  })

  test('DELETE /users/me は本人確認後にアカウントを削除しCookieをクリアする', async () => {
    deleteAccount.mockResolvedValue('DELETED')
    const token = await createToken(1)

    const response = await app.request('/users/me', {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ currentPassword: 'current-password-123' }),
    })

    expect(response.status).toBe(204)
    expect(deleteAccount).toHaveBeenCalledTimes(1)
    expect(response.headers.get('set-cookie')).toContain('refreshToken=')
  })

  test('DELETE /users/me は現在のパスワードが不一致なら401を返す', async () => {
    deleteAccount.mockResolvedValue('INVALID_PASSWORD')
    const token = await createToken(1)

    const response = await app.request('/users/me', {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ currentPassword: 'wrong-password' }),
    })

    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  test('DELETE /users/me は唯一のOWNERである組織が存在する場合に409を返す', async () => {
    deleteAccount.mockResolvedValue('SOLE_OWNER')
    const token = await createToken(1)

    const response = await app.request('/users/me', {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ currentPassword: 'current-password-123' }),
    })

    expect(response.status).toBe(409)
  })

  test('DELETE /users/me は処理中にユーザーが存在しなくなったら404を返す', async () => {
    deleteAccount.mockResolvedValue('NOT_FOUND')
    const token = await createToken(1)

    const response = await app.request('/users/me', {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ currentPassword: 'current-password-123' }),
    })

    expect(response.status).toBe(404)
  })

  test('DELETE /users/me はbodyなしなら400を返す', async () => {
    const token = await createToken(1)

    const response = await app.request('/users/me', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(400)
    expect(deleteAccount).not.toHaveBeenCalled()
  })

  test('GET /users/:id は指定ユーザーの公開情報だけを返す', async () => {
    findById.mockResolvedValue({ ...user, id: 2, name: 'Public User', email: 'public@example.com' })
    const token = await createToken(1)

    const response = await app.request('/users/2', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body).toEqual({
      id: 2,
      name: 'Public User',
    })
    expect(body).not.toHaveProperty('email')
    expect(body).not.toHaveProperty('password')
  })

  test('GET /users/:id は不正なIDなら400を返す', async () => {
    const token = await createToken(1)

    const response = await app.request('/users/me-invalid', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(response.status).toBe(400)
  })

  test('GET /users/me はトークンがなければ401を返す', async () => {
    const response = await app.request('/users/me')

    expect(response.status).toBe(401)
  })
})
