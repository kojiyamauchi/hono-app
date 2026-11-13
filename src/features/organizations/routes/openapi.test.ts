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

  describe('AuditLog（6イベントのunion）', () => {
    type Property = { enum?: string[]; type?: string | string[]; description?: string; $ref?: string }
    type EventSchema = { type?: string; properties: Record<string, Property>; required?: string[] }
    type Union = { oneOf?: { $ref: string }[]; discriminator?: { propertyName: string; mapping: Record<string, string> } }

    const eventComponents = {
      MEMBER_ROLE_CHANGED: 'MemberRoleChangedAuditLog',
      OWNERSHIP_TRANSFERRED: 'OwnershipTransferredAuditLog',
      MEMBER_REMOVED: 'MemberRemovedAuditLog',
      PROJECT_CREATED: 'ProjectCreatedAuditLog',
      PROJECT_UPDATED: 'ProjectUpdatedAuditLog',
      PROJECT_DELETED: 'ProjectDeletedAuditLog',
    } as const

    const eventSchema = (doc: Awaited<ReturnType<typeof fetchOpenApiDoc>>, name: string): EventSchema => doc.components?.schemas?.[name] as EventSchema

    test('AuditLogは6 componentのoneOfで、actionを判別子とするdiscriminatorが各componentへ対応する', async () => {
      const doc = await fetchOpenApiDoc()
      const union = doc.components?.schemas?.AuditLog as Union

      expect(union.oneOf?.map((entry) => entry.$ref)).toEqual(Object.values(eventComponents).map((name) => `#/components/schemas/${name}`))
      expect(union.discriminator?.propertyName).toBe('action')
      expect(union.discriminator?.mapping).toEqual(
        Object.fromEntries(Object.entries(eventComponents).map(([action, name]) => [action, `#/components/schemas/${name}`])),
      )
      // 一覧はAuditLogの配列を参照する
      const list = doc.components?.schemas?.AuditLogList as { properties: { items: { items: { $ref: string } } } }
      expect(list.properties.items.items.$ref).toBe('#/components/schemas/AuditLog')
    })

    test('各イベントcomponentのactionは対応する単一値に固定される', async () => {
      const doc = await fetchOpenApiDoc()

      for (const [action, name] of Object.entries(eventComponents)) {
        expect(eventSchema(doc, name).properties.action.enum).toEqual([action])
        expect(eventSchema(doc, name).required).toContain('action')
      }
    })

    test('既存3イベントはメンバー向け項目が必須でプロジェクト向け項目を持たず、MEMBER_REMOVEDのnewRoleはnull型、他2種はロール値', async () => {
      const doc = await fetchOpenApiDoc()
      const memberRequired = ['id', 'organizationId', 'action', 'actorUserId', 'createdAt', 'targetUserId', 'targetMembershipId', 'previousRole', 'newRole']

      for (const name of ['MemberRoleChangedAuditLog', 'OwnershipTransferredAuditLog', 'MemberRemovedAuditLog']) {
        const schema = eventSchema(doc, name)
        expect([...(schema.required ?? [])].sort()).toEqual([...memberRequired].sort())
        for (const key of ['projectId', 'before', 'after', 'projectBefore', 'projectAfter']) {
          expect(schema.properties).not.toHaveProperty(key)
        }
      }
      expect(eventSchema(doc, 'MemberRoleChangedAuditLog').properties.newRole.enum).toEqual([...roleValues])
      expect(eventSchema(doc, 'OwnershipTransferredAuditLog').properties.newRole.enum).toEqual([...roleValues])
      // 説明文中の「null」で通らないよう、生成されたtypeを個別に検証する
      expect(eventSchema(doc, 'MemberRemovedAuditLog').properties.newRole.type).toBe('null')
      expect(eventSchema(doc, 'OwnershipTransferredAuditLog').properties.actorUserId.description).toContain('移譲元')
    })

    test('プロジェクト3イベントは共通項目 + projectId + before + after が必須でメンバー向け項目を持たず、nullを型で表現する', async () => {
      const doc = await fetchOpenApiDoc()
      const projectRequired = ['id', 'organizationId', 'action', 'actorUserId', 'createdAt', 'projectId', 'before', 'after']

      for (const name of ['ProjectCreatedAuditLog', 'ProjectUpdatedAuditLog', 'ProjectDeletedAuditLog']) {
        const schema = eventSchema(doc, name)
        expect([...(schema.required ?? [])].sort()).toEqual([...projectRequired].sort())
        for (const key of ['targetUserId', 'targetMembershipId', 'previousRole', 'newRole', 'projectBefore', 'projectAfter']) {
          expect(schema.properties).not.toHaveProperty(key)
        }
      }
      // 作成のbefore、削除のafterはnull型。それ以外はスナップショット参照
      expect(eventSchema(doc, 'ProjectCreatedAuditLog').properties.before.type).toBe('null')
      expect(eventSchema(doc, 'ProjectCreatedAuditLog').properties.after.$ref).toBe('#/components/schemas/ProjectAuditSnapshot')
      expect(eventSchema(doc, 'ProjectDeletedAuditLog').properties.after.type).toBe('null')
      expect(eventSchema(doc, 'ProjectDeletedAuditLog').properties.before.$ref).toBe('#/components/schemas/ProjectAuditSnapshot')
      expect(JSON.stringify(eventSchema(doc, 'ProjectUpdatedAuditLog').properties.before)).toContain('#/components/schemas/ProjectAuditSnapshot')
      expect(JSON.stringify(eventSchema(doc, 'ProjectUpdatedAuditLog').properties.after)).toContain('#/components/schemas/ProjectAuditSnapshot')
    })

    test('ProjectAuditSnapshotはnameとdescriptionを必須とし、descriptionはstring | nullで文字数制約を持たない', async () => {
      const doc = await fetchOpenApiDoc()
      const snapshot = doc.components?.schemas?.ProjectAuditSnapshot as EventSchema

      expect([...(snapshot.required ?? [])].sort()).toEqual(['description', 'name'])
      expect(Object.keys(snapshot.properties).sort()).toEqual(['description', 'name'])
      expect(snapshot.properties.description.type).toEqual(['string', 'null'])
      expect(snapshot.properties.name).not.toHaveProperty('maxLength')
      expect(snapshot.properties.name).not.toHaveProperty('minLength')
      expect(snapshot.properties.description).not.toHaveProperty('maxLength')
    })

    test('一覧の説明に6イベントとcreatedAt・順序の注意が含まれる', async () => {
      const doc = await fetchOpenApiDoc()

      const auditLogsGet = doc.paths?.['/organizations/{id}/audit-logs']?.get as { description?: string }
      for (const action of Object.keys(eventComponents)) {
        expect(auditLogsGet.description).toContain(action)
      }
      expect(auditLogsGet.description).toContain('確定順を保証しない')
    })
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

  test('プロジェクトAPIの5 endpointが認証・パスパラメータ・response付きで定義されている', async () => {
    const doc = await fetchOpenApiDoc()

    type Operation = {
      tags?: string[]
      security?: unknown[]
      parameters?: { name: string; in: string; required?: boolean; schema?: { maximum?: number } }[]
      requestBody?: { required?: boolean; content: Record<string, { schema?: { $ref?: string } }> }
      responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>
    }
    const operation = (path: string, method: string): Operation => doc.paths?.[path]?.[method] as Operation
    const errorRef = (op: Operation, status: string): string | undefined => op.responses[status].content?.['application/json'].schema?.$ref

    const list = operation('/organizations/{id}/projects', 'get')
    const create = operation('/organizations/{id}/projects', 'post')
    const get = operation('/organizations/{id}/projects/{projectId}', 'get')
    const update = operation('/organizations/{id}/projects/{projectId}', 'patch')
    const remove = operation('/organizations/{id}/projects/{projectId}', 'delete')

    for (const op of [list, create, get, update, remove]) {
      expect(op.tags).toEqual(['Organization Projects'])
      expect(op.security).toEqual([{ bearerAuth: [] }])
      expect(errorRef(op, '401')).toBe('#/components/schemas/ErrorResponse')
      expect(errorRef(op, '400')).toBe('#/components/schemas/ErrorResponse')
      expect(errorRef(op, '404')).toBe('#/components/schemas/ErrorResponse')
      expect(op.parameters?.find((p) => p.name === 'id')?.schema?.maximum).toBe(2147483647)
    }
    for (const op of [get, update, remove]) {
      const projectIdParam = op.parameters?.find((p) => p.name === 'projectId')
      expect(projectIdParam?.in).toBe('path')
      expect(projectIdParam?.required).toBe(true)
      expect(projectIdParam?.schema?.maximum).toBe(2147483647)
    }

    expect(list.responses['200'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/ProjectList')
    // カーソル式: limit + cursorのみ
    expect(list.parameters?.filter((p) => p.in === 'query').map((p) => p.name)).toEqual(['limit', 'cursor'])
    expect(create.responses['201'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/Project')
    expect(get.responses['200'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/Project')
    expect(update.responses['200'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/Project')
    expect(remove.responses['204']).toBeDefined()
    expect(remove.responses['204'].content).toBeUndefined()

    // 書き込み系はbodyを必須とし、MEMBERの403を定義する
    expect(create.requestBody?.required).toBe(true)
    expect(create.requestBody?.content['application/json'].schema?.$ref).toBe('#/components/schemas/CreateProjectRequest')
    expect(update.requestBody?.required).toBe(true)
    expect(update.requestBody?.content['application/json'].schema?.$ref).toBe('#/components/schemas/UpdateProjectRequest')
    expect(remove.requestBody).toBeUndefined()
    for (const op of [create, update, remove]) {
      expect(errorRef(op, '403')).toBe('#/components/schemas/ErrorResponse')
    }
    expect(list.responses['403']).toBeUndefined()
    expect(get.responses['403']).toBeUndefined()
  })

  test('ProjectのDTOは6項目を必須とし、descriptionはnullを許容する型で公開される', async () => {
    const doc = await fetchOpenApiDoc()

    type Property = { type?: string | string[]; nullable?: boolean }
    const project = doc.components?.schemas?.Project as { properties: Record<string, Property>; required?: string[] }

    expect(Object.keys(project.properties).sort()).toEqual(['createdAt', 'description', 'id', 'name', 'organizationId', 'updatedAt'])
    expect([...(project.required ?? [])].sort()).toEqual(['createdAt', 'description', 'id', 'name', 'organizationId', 'updatedAt'])
    expect(project.properties.description.type).toEqual(['string', 'null'])
    expect(project.properties.description.nullable).toBeUndefined()

    const projectList = doc.components?.schemas?.ProjectList as { required?: string[] }
    expect([...(projectList.required ?? [])].sort()).toEqual(['items', 'nextCursor'])
  })

  test('プロジェクトのnull許容項目（POST/PATCHのdescription、一覧のnextCursor）はOpenAPI 3.1のtype配列で表現され、nullableを持たない', async () => {
    const doc = await fetchOpenApiDoc()

    type Property = { type?: string | string[]; nullable?: boolean; maxLength?: number }
    const propertyOf = (schemaName: string, property: string): Property =>
      (doc.components?.schemas?.[schemaName] as { properties: Record<string, Property> }).properties[property]

    for (const [schemaName, property] of [
      ['CreateProjectRequest', 'description'],
      ['UpdateProjectRequest', 'description'],
      ['ProjectList', 'nextCursor'],
    ]) {
      const generated = propertyOf(schemaName, property)
      expect(generated.type).toContain('null')
      expect(generated.type).toContain('string')
      expect(generated).not.toHaveProperty('nullable')
    }
    // 型の上書きで既存の文字数制約が失われていない
    expect(propertyOf('CreateProjectRequest', 'description').maxLength).toBe(2000)
    expect(propertyOf('UpdateProjectRequest', 'description').maxLength).toBe(2000)
  })

  test('プロジェクトのrequest bodyは未知の項目を拒否し、更新はnameのnullを許容しない', async () => {
    const doc = await fetchOpenApiDoc()

    type BodySchema = {
      additionalProperties?: boolean
      minProperties?: number
      required?: string[]
      properties: Record<string, { type?: string | string[]; maxLength?: number }>
    }
    const createBody = doc.components?.schemas?.CreateProjectRequest as BodySchema
    const updateBody = doc.components?.schemas?.UpdateProjectRequest as BodySchema

    expect(createBody.additionalProperties).toBe(false)
    expect(createBody.required).toEqual(['name'])
    expect(createBody.properties.name.maxLength).toBe(100)
    expect(updateBody.additionalProperties).toBe(false)
    expect(updateBody.required ?? []).toEqual([])
    // 空のPATCH（{}）はrefineで400になるため、公開仕様にも少なくとも1項目必須として反映する
    expect(updateBody.minProperties).toBe(1)
    expect(Object.keys(updateBody.properties).sort()).toEqual(['description', 'name'])
    expect(createBody.minProperties).toBeUndefined()
    expect(updateBody.properties.name.type).toBe('string')
  })
})
