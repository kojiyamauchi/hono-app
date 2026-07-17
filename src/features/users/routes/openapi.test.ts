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

describe('users routes OpenAPI定義', () => {
  test('/users/me と /users/{id} が paths へ反映されている', async () => {
    const doc = await fetchOpenApiDoc()

    expect(doc.paths?.['/users/me']?.get).toBeDefined()
    expect(doc.paths?.['/users/me']?.patch).toBeDefined()
    expect(doc.paths?.['/users/me']?.delete).toBeDefined()
    expect(doc.paths?.['/users/{id}']?.get).toBeDefined()
  })

  test('認証が必要なendpointにBearer securityが付いている', async () => {
    const doc = await fetchOpenApiDoc()

    const meGet = doc.paths?.['/users/me']?.get as { security?: unknown[] }
    expect(meGet.security).toEqual([{ bearerAuth: [] }])
  })

  test('response DTO / request body / error response がschema参照になっている', async () => {
    const doc = await fetchOpenApiDoc()

    const meGet = doc.paths?.['/users/me']?.get as {
      responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>
    }
    // 200はUser DTO、401など主要エラーは共通ErrorResponseを参照する
    expect(meGet.responses['200'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/User')
    expect(meGet.responses['401'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/ErrorResponse')

    const patchMe = doc.paths?.['/users/me']?.patch as {
      requestBody: { content: Record<string, { schema?: { $ref?: string } }> }
    }
    expect(patchMe.requestBody.content['application/json'].schema?.$ref).toBe('#/components/schemas/UpdateMeRequest')

    const deleteMe = doc.paths?.['/users/me']?.delete as {
      requestBody: { content: Record<string, { schema?: { $ref?: string } }> }
      responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>
      security?: unknown[]
    }
    expect(deleteMe.requestBody.content['application/json'].schema?.$ref).toBe('#/components/schemas/DeleteMeRequest')
    expect(deleteMe.security).toEqual([{ bearerAuth: [] }])
    for (const status of ['400', '401', '404', '409']) {
      expect(deleteMe.responses[status]?.content?.['application/json'].schema?.$ref).toBe('#/components/schemas/ErrorResponse')
    }

    // 公開情報取得は PublicUser DTO を参照する
    const getById = doc.paths?.['/users/{id}']?.get as {
      responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>
    }
    expect(getById.responses['200'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/PublicUser')

    // component schemasが登録されている
    expect(doc.components?.schemas?.User).toBeDefined()
    expect(doc.components?.schemas?.PublicUser).toBeDefined()
    expect(doc.components?.schemas?.UpdateMeRequest).toBeDefined()
    expect(doc.components?.schemas?.DeleteMeRequest).toBeDefined()

    const userSchema = doc.components?.schemas?.User as {
      properties?: Record<string, { type?: string }>
      required?: string[]
    }
    expect(userSchema.properties?.emailVerified?.type).toBe('boolean')
    expect(userSchema.required).toContain('emailVerified')
  })

  test('/{id} のパスパラメータが定義されている', async () => {
    const doc = await fetchOpenApiDoc()

    const getById = doc.paths?.['/users/{id}']?.get as {
      parameters?: { name: string; in: string; required?: boolean }[]
    }
    const idParam = getById.parameters?.find((p) => p.name === 'id')
    expect(idParam?.in).toBe('path')
    expect(idParam?.required).toBe(true)
  })
})
