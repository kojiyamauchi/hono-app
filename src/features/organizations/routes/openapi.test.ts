import { describe, expect, test } from 'bun:test'

import { roleValues } from '@/shared/membership/entities'

// registerOpenApiRoutes は登録時に ENABLE_API_DOCS を評価するため、app import より前に有効化する。
process.env.ENABLE_API_DOCS = 'true'

const { app } = await import('@/app')

/** OpenAPI JSON（/open-api/doc）を取得してパースする。 */
const fetchOpenApiDoc = async (): Promise<{
  openapi?: string
  paths?: Record<string, Record<string, unknown>>
  components?: { schemas?: Record<string, unknown> }
}> => {
  const response = await app.request('/open-api/doc')
  expect(response.status).toBe(200)
  return response.json()
}

describe('organizations routes OpenAPI定義', () => {
  test('招待一覧GETの200はInvitationListItemの配列で、emailDeliveryStatusは必須かつ5値とnullを許容する', async () => {
    const doc = await fetchOpenApiDoc()

    const listGet = doc.paths?.['/organizations/{id}/invitations']?.get as {
      responses: Record<string, { content?: Record<string, { schema?: { type?: string; items?: { $ref?: string } } }> }>
    }
    expect(doc.openapi).toBe('3.1.0')
    const schema = listGet.responses['200'].content?.['application/json'].schema
    expect(schema?.type).toBe('array')
    expect(schema?.items?.$ref).toBe('#/components/schemas/InvitationListItem')

    // 生成結果は既存InvitationへのallOfと、emailDeliveryStatusを追加するobjectで表現される
    type Extension = { properties?: Record<string, { enum?: (string | null)[]; type?: string | string[]; nullable?: boolean }>; required?: string[] }
    const listItem = doc.components?.schemas?.InvitationListItem as { allOf?: ({ $ref?: string } & Extension)[] }
    expect(listItem.allOf?.some((part) => part.$ref === '#/components/schemas/Invitation')).toBe(true)
    const extension = listItem.allOf?.find((part) => part.properties?.emailDeliveryStatus)
    expect(extension?.required).toContain('emailDeliveryStatus')
    const property = extension?.properties?.emailDeliveryStatus
    expect(property?.type).toEqual(['string', 'null'])
    expect(property?.nullable).toBeUndefined()
    expect(property?.enum).toEqual(['PENDING', 'ACCEPTED', 'REJECTED', 'UNKNOWN', 'SKIPPED', null])
  })

  test('招待作成POSTのInvitationにはemailDeliveryStatusが追加されていない', async () => {
    const doc = await fetchOpenApiDoc()

    const createPost = doc.paths?.['/organizations/{id}/invitations']?.post as {
      responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>
    }
    expect(createPost.responses['201'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/Invitation')
    const invitation = doc.components?.schemas?.Invitation as { properties?: Record<string, unknown>; required?: string[] }
    expect(invitation.properties).not.toHaveProperty('emailDeliveryStatus')
    expect(invitation.required).not.toContain('emailDeliveryStatus')

    // トークンによる詳細取得のInvitationDetailにも追加されていない
    const detail = doc.components?.schemas?.InvitationDetail as { properties?: Record<string, unknown>; required?: string[] }
    expect(detail.properties).not.toHaveProperty('emailDeliveryStatus')
    expect(detail.required).not.toContain('emailDeliveryStatus')
  })

  test('15 path × method が paths へ反映されている', async () => {
    const doc = await fetchOpenApiDoc()

    expect(doc.paths?.['/organizations']?.get).toBeDefined()
    expect(doc.paths?.['/organizations']?.post).toBeDefined()
    expect(doc.paths?.['/organizations/{id}']?.get).toBeDefined()
    expect(doc.paths?.['/organizations/{id}']?.patch).toBeDefined()
    expect(doc.paths?.['/organizations/{id}']?.delete).toBeDefined()
    expect(doc.paths?.['/organizations/{id}/transfer-ownership']?.post).toBeDefined()
    expect(doc.paths?.['/organizations/{id}/members']?.get).toBeDefined()
    expect(doc.paths?.['/organizations/{id}/members']?.post).toBeDefined()
    expect(doc.paths?.['/organizations/{id}/members/me']?.delete).toBeDefined()
    expect(doc.paths?.['/organizations/{id}/members/{membershipId}']?.patch).toBeDefined()
    expect(doc.paths?.['/organizations/{id}/members/{membershipId}']?.delete).toBeDefined()
    expect(doc.paths?.['/organizations/{id}/audit-logs']?.get).toBeDefined()
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

    // component schemasが登録されている
    expect(doc.components?.schemas?.Organization).toBeDefined()
    expect(doc.components?.schemas?.Member).toBeDefined()
    expect(doc.components?.schemas?.Invitation).toBeDefined()
    expect(doc.components?.schemas?.OrganizationList).toBeDefined()
    expect(doc.components?.schemas?.MemberList).toBeDefined()
    expect(doc.components?.schemas?.AuditLog).toBeDefined()
    expect(doc.components?.schemas?.AuditLogList).toBeDefined()
    expect(doc.components?.schemas?.CreateOrganizationRequest).toBeDefined()
    expect(doc.components?.schemas?.UpdateOrganizationRequest).toBeDefined()
    expect(doc.components?.schemas?.AddMemberRequest).toBeDefined()
    expect(doc.components?.schemas?.UpdateMemberRoleRequest).toBeDefined()
    expect(doc.components?.schemas?.TransferOrganizationOwnershipRequest).toBeDefined()
    expect(doc.components?.schemas?.CreateInvitationRequest).toBeDefined()
  })

  test('一覧endpointの200がページネーションDTOを参照し、queryパラメータが方式ごとに定義されている', async () => {
    const doc = await fetchOpenApiDoc()

    type ListOperation = {
      parameters?: { name: string; in: string; required?: boolean }[]
      responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>
    }
    const listMineGet = doc.paths?.['/organizations']?.get as ListOperation
    const listMembersGet = doc.paths?.['/organizations/{id}/members']?.get as ListOperation

    expect(listMineGet.responses['200'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/OrganizationList')
    expect(listMembersGet.responses['200'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/MemberList')
    expect(listMineGet.responses['400'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/ErrorResponse')

    // オフセット式: limit + offset。未対応のcursorは出さない
    const listMineQueryNames = listMineGet.parameters?.filter((parameter) => parameter.in === 'query').map((parameter) => parameter.name)
    expect(listMineQueryNames).toContain('limit')
    expect(listMineQueryNames).toContain('offset')
    expect(listMineQueryNames).not.toContain('cursor')

    // カーソル式: limit + cursor。未対応のoffsetは出さない
    const listMembersQueryNames = listMembersGet.parameters?.filter((parameter) => parameter.in === 'query').map((parameter) => parameter.name)
    expect(listMembersQueryNames).toContain('limit')
    expect(listMembersQueryNames).toContain('cursor')
    expect(listMembersQueryNames).not.toContain('offset')
    expect(listMembersGet.parameters?.find((parameter) => parameter.name === 'id')?.in).toBe('path')

    // coerceがnullを0として受けると生成schemaへ nullable: true が付くため、整数のみであることを固定する
    const offsetParam = listMineGet.parameters?.find((parameter) => parameter.name === 'offset') as { schema?: Record<string, unknown> } | undefined
    expect(offsetParam?.schema).toEqual({ type: 'integer', minimum: 0, maximum: 10000, default: 0, example: 0 })
  })

  test('監査ログ一覧endpointの認証、パス・queryパラメータ、responseが定義されている', async () => {
    const doc = await fetchOpenApiDoc()

    const auditLogsGet = doc.paths?.['/organizations/{id}/audit-logs']?.get as {
      tags?: string[]
      security?: unknown[]
      parameters?: { name: string; in: string; required?: boolean; schema?: { maximum?: number } }[]
      responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>
    }
    expect(auditLogsGet.tags).toEqual(['Organization Audit Logs'])
    expect(auditLogsGet.security).toEqual([{ bearerAuth: [] }])

    const idParam = auditLogsGet.parameters?.find((parameter) => parameter.name === 'id')
    expect(idParam?.in).toBe('path')
    expect(idParam?.required).toBe(true)
    // 監査ログ一覧専用のパスschemaはPostgreSQL INTEGERの上限をmaximumとして公開する
    expect(idParam?.schema?.maximum).toBe(2147483647)

    // カーソル式: limit + cursor。未対応のoffsetは出さない
    const queryNames = auditLogsGet.parameters?.filter((parameter) => parameter.in === 'query').map((parameter) => parameter.name)
    expect(queryNames).toContain('limit')
    expect(queryNames).toContain('cursor')
    expect(queryNames).not.toContain('offset')

    expect(auditLogsGet.responses['200'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/AuditLogList')
    for (const status of ['400', '401', '403', '404', '500']) {
      expect(auditLogsGet.responses[status].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/ErrorResponse')
    }
  })

  test('AuditLogのactionに3種のイベント種別が含まれ、イベント種別ごとの項目の意味がdescriptionに出る', async () => {
    const doc = await fetchOpenApiDoc()

    type Property = { enum?: (string | null)[]; type?: string | string[]; anyOf?: unknown[]; nullable?: boolean; description?: string }
    const auditLog = doc.components?.schemas?.AuditLog as { properties: Record<string, Property>; required?: string[] }

    expect(auditLog.properties.action.enum).toEqual(['MEMBER_ROLE_CHANGED', 'OWNERSHIP_TRANSFERRED', 'MEMBER_REMOVED'])
    for (const name of ['actorUserId', 'previousRole', 'newRole']) {
      expect(auditLog.properties[name].description).toContain('MEMBER_ROLE_CHANGED')
      expect(auditLog.properties[name].description).toContain('OWNERSHIP_TRANSFERRED')
      expect(auditLog.properties[name].description).toContain('MEMBER_REMOVED')
    }
    expect(auditLog.properties.actorUserId.description).toContain('移譲元')
    expect(auditLog.properties.newRole.description).toContain('OWNER')

    // newRoleは常にキーを返し、MEMBER_REMOVEDではnullになるためrequiredのまま、OpenAPI 3.1のJSON Schemaとしてnullを許容する型で公開する
    // 説明文中の「null」で通らないよう、生成されたtypeとenumを個別に検証する
    expect(auditLog.required).toContain('newRole')
    expect(auditLog.properties.newRole.type).toEqual(['string', 'null'])
    expect(auditLog.properties.newRole.enum).toEqual([...roleValues, null])

    const auditLogsGet = doc.paths?.['/organizations/{id}/audit-logs']?.get as { description?: string }
    expect(auditLogsGet.description).toContain('OWNERSHIP_TRANSFERRED')
    expect(auditLogsGet.description).toContain('MEMBER_REMOVED')
  })

  test('組織IDの上限（maximum）は監査ログ一覧のpath parameterだけに出て、他の組織ルートには出ない', async () => {
    const doc = await fetchOpenApiDoc()

    type PathOperation = { parameters?: { name: string; in: string; schema?: { maximum?: number } }[] }
    const idMaximum = (path: string, method: string): number | undefined =>
      (doc.paths?.[path]?.[method] as PathOperation).parameters?.find((parameter) => parameter.name === 'id')?.schema?.maximum

    expect(idMaximum('/organizations/{id}/audit-logs', 'get')).toBe(2147483647)
    expect(idMaximum('/organizations/{id}', 'get')).toBeUndefined()
    expect(idMaximum('/organizations/{id}/members', 'get')).toBeUndefined()
    expect(idMaximum('/organizations/{id}/invitations', 'get')).toBeUndefined()
  })

  test('所有権移譲endpointのrequest bodyとresponseが定義されている', async () => {
    const doc = await fetchOpenApiDoc()

    const transferOwnershipPost = doc.paths?.['/organizations/{id}/transfer-ownership']?.post as {
      security?: unknown[]
      requestBody: { content: Record<string, { schema?: { $ref?: string } }> }
      responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>
    }
    expect(transferOwnershipPost.security).toEqual([{ bearerAuth: [] }])
    expect(transferOwnershipPost.requestBody.content['application/json'].schema?.$ref).toBe('#/components/schemas/TransferOrganizationOwnershipRequest')
    expect(transferOwnershipPost.responses['204']).toBeDefined()
    expect(transferOwnershipPost.responses['403'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/ErrorResponse')
    expect(transferOwnershipPost.responses['404'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/ErrorResponse')
    expect(transferOwnershipPost.responses['409'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/ErrorResponse')
    expect(transferOwnershipPost.responses['422'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/ErrorResponse')
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

  test('組織脱退endpointの認証、パスパラメータ、responseが定義されている', async () => {
    const doc = await fetchOpenApiDoc()

    const leaveOrganizationDelete = doc.paths?.['/organizations/{id}/members/me']?.delete as {
      security?: unknown[]
      parameters?: { name: string; in: string; required?: boolean }[]
      responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>
    }
    expect(leaveOrganizationDelete.security).toEqual([{ bearerAuth: [] }])

    const idParam = leaveOrganizationDelete.parameters?.find((parameter) => parameter.name === 'id')
    expect(idParam?.in).toBe('path')
    expect(idParam?.required).toBe(true)
    expect(leaveOrganizationDelete.parameters?.some((parameter) => parameter.name === 'membershipId')).toBe(false)

    expect(leaveOrganizationDelete.responses['204']).toBeDefined()
    expect(leaveOrganizationDelete.responses['401'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/ErrorResponse')
    expect(leaveOrganizationDelete.responses['404'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/ErrorResponse')
    expect(leaveOrganizationDelete.responses['409'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/ErrorResponse')
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

  test('/organizations/{id}/invitations/{invitationId}/resend-email のPOSTが本文なしの202と共通エラー応答を定義している', async () => {
    const doc = await fetchOpenApiDoc()

    const resendPost = doc.paths?.['/organizations/{id}/invitations/{invitationId}/resend-email']?.post as {
      security?: unknown[]
      requestBody?: unknown
      parameters?: { name: string; in: string; required?: boolean }[]
      responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>
    }
    expect(resendPost.security).toEqual([{ bearerAuth: [] }])
    expect(resendPost.requestBody).toBeUndefined()
    expect(resendPost.parameters?.find((p) => p.name === 'id')?.in).toBe('path')
    expect(resendPost.parameters?.find((p) => p.name === 'invitationId')?.in).toBe('path')
    expect(resendPost.responses['202']).toBeDefined()
    expect(resendPost.responses['202'].content).toBeUndefined()
    for (const status of ['400', '401', '403', '404', '409', '500']) {
      expect(resendPost.responses[status].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/ErrorResponse')
    }
  })

  test('再送のdescriptionに配信設定・招待状態と期限・手動Job・権限表・再呼び出しの案内が含まれる', async () => {
    const doc = await fetchOpenApiDoc()

    const resendPost = doc.paths?.['/organizations/{id}/invitations/{invitationId}/resend-email']?.post as { description?: string }
    const description = resendPost.description ?? ''
    expect(description).toContain('ENABLE_INVITATION_EMAIL=true')
    expect(description).toContain('PENDING')
    expect(description).toContain('同時刻は期限切れ')
    expect(description).toContain('REJECTED')
    expect(description).toContain('client または rate_limited')
    expect(description).toContain('OWNER が ADMIN／MEMBER 宛て')
    expect(description).toContain('ADMIN が MEMBER 宛て')
    expect(description).toContain('MEMBER は不可')
    expect(description).toContain('手動Job')
    expect(description).toContain('emailDeliveryStatus')
    expect(description).toContain('既に受け付けています')
  })
})
