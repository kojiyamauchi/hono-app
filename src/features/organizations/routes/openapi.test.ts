import { describe, expect, test } from 'bun:test'

// registerOpenApiRoutes は登録時に ENABLE_API_DOCS を評価するため、app import より前に有効化する。
process.env.ENABLE_API_DOCS = 'true'

const { app } = await import('@/app')

/** OpenAPI JSON（/open-api/doc）を取得してパースする。 */
const fetchOpenApiDoc = async (): Promise<{
  paths?: Record<string, Record<string, unknown>>
  components?: { schemas?: Record<string, unknown> }
}> => {
  const response = await app.request('/open-api/doc')
  expect(response.status).toBe(200)
  return response.json()
}

describe('organizations routes OpenAPI定義', () => {
  test('12 path × method が paths へ反映されている', async () => {
    const doc = await fetchOpenApiDoc()

    expect(doc.paths?.['/organizations']?.get).toBeDefined()
    expect(doc.paths?.['/organizations']?.post).toBeDefined()
    expect(doc.paths?.['/organizations/{id}']?.get).toBeDefined()
    expect(doc.paths?.['/organizations/{id}']?.patch).toBeDefined()
    expect(doc.paths?.['/organizations/{id}']?.delete).toBeDefined()
    expect(doc.paths?.['/organizations/{id}/members']?.get).toBeDefined()
    expect(doc.paths?.['/organizations/{id}/members']?.post).toBeDefined()
    expect(doc.paths?.['/organizations/{id}/members/{membershipId}']?.patch).toBeDefined()
    expect(doc.paths?.['/organizations/{id}/members/{membershipId}']?.delete).toBeDefined()
    expect(doc.paths?.['/organizations/{id}/invitations']?.get).toBeDefined()
    expect(doc.paths?.['/organizations/{id}/invitations']?.post).toBeDefined()
    expect(doc.paths?.['/organizations/{id}/invitations/{invitationId}']?.delete).toBeDefined()
  })

  test('認証が必要なendpointにBearer securityが付いている', async () => {
    const doc = await fetchOpenApiDoc()

    const listMineGet = doc.paths?.['/organizations']?.get as { security?: unknown[] }
    expect(listMineGet.security).toEqual([{ bearerAuth: [] }])

    const getByIdGet = doc.paths?.['/organizations/{id}']?.get as { security?: unknown[] }
    expect(getByIdGet.security).toEqual([{ bearerAuth: [] }])
  })

  test('response DTO / request body / error response がschema参照になっている', async () => {
    const doc = await fetchOpenApiDoc()

    const createPost = doc.paths?.['/organizations']?.post as {
      requestBody: { content: Record<string, { schema?: { $ref?: string } }> }
      responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>
    }
    expect(createPost.responses['201'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/Organization')
    expect(createPost.responses['400'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/ErrorResponse')
    expect(createPost.responses['401'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/ErrorResponse')
    expect(createPost.requestBody.content['application/json'].schema?.$ref).toBe('#/components/schemas/CreateOrganizationRequest')

    // 一覧の200はOrganization DTOの配列
    const listMineGet = doc.paths?.['/organizations']?.get as {
      responses: Record<string, { content?: Record<string, { schema?: { type?: string; items?: { $ref?: string } } }> }>
    }
    expect(listMineGet.responses['200'].content?.['application/json'].schema).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/Organization' },
    })

    // component schemasが登録されている
    expect(doc.components?.schemas?.Organization).toBeDefined()
    expect(doc.components?.schemas?.Member).toBeDefined()
    expect(doc.components?.schemas?.Invitation).toBeDefined()
    expect(doc.components?.schemas?.CreateOrganizationRequest).toBeDefined()
    expect(doc.components?.schemas?.UpdateOrganizationRequest).toBeDefined()
    expect(doc.components?.schemas?.AddMemberRequest).toBeDefined()
    expect(doc.components?.schemas?.UpdateMemberRoleRequest).toBeDefined()
    expect(doc.components?.schemas?.CreateInvitationRequest).toBeDefined()
  })

  test('/organizations/{id}/members/{membershipId} のパスパラメータがidとmembershipIdの両方定義されている', async () => {
    const doc = await fetchOpenApiDoc()

    const removeMemberDelete = doc.paths?.['/organizations/{id}/members/{membershipId}']?.delete as {
      parameters?: { name: string; in: string; required?: boolean }[]
    }
    const idParam = removeMemberDelete.parameters?.find((p) => p.name === 'id')
    const membershipIdParam = removeMemberDelete.parameters?.find((p) => p.name === 'membershipId')
    expect(idParam?.in).toBe('path')
    expect(idParam?.required).toBe(true)
    expect(membershipIdParam?.in).toBe('path')
    expect(membershipIdParam?.required).toBe(true)
  })

  test('/organizations/{id}/invitations/{invitationId} のパスパラメータがidとinvitationIdの両方定義されている', async () => {
    const doc = await fetchOpenApiDoc()

    const cancelInvitationDelete = doc.paths?.['/organizations/{id}/invitations/{invitationId}']?.delete as {
      parameters?: { name: string; in: string; required?: boolean }[]
    }
    const idParam = cancelInvitationDelete.parameters?.find((p) => p.name === 'id')
    const invitationIdParam = cancelInvitationDelete.parameters?.find((p) => p.name === 'invitationId')
    expect(idParam?.in).toBe('path')
    expect(idParam?.required).toBe(true)
    expect(invitationIdParam?.in).toBe('path')
    expect(invitationIdParam?.required).toBe(true)
  })
})
