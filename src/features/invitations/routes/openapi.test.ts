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

describe('invitations routes OpenAPI定義', () => {
  test('/invitations配下の4 pathがpathsへ反映されている', async () => {
    const doc = await fetchOpenApiDoc()

    expect(doc.paths?.['/invitations/{token}']?.get).toBeDefined()
    expect(doc.paths?.['/invitations/accept']?.post).toBeDefined()
    expect(doc.paths?.['/invitations/decline']?.post).toBeDefined()
    expect(doc.paths?.['/invitations/signup']?.post).toBeDefined()
  })

  test('acceptにBearer securityが付き、他の3endpointにはsecurityが設定されていない', async () => {
    const doc = await fetchOpenApiDoc()

    const acceptPost = doc.paths?.['/invitations/accept']?.post as { security?: unknown[] }
    expect(acceptPost.security).toEqual([{ bearerAuth: [] }])

    const getDetail = doc.paths?.['/invitations/{token}']?.get as { security?: unknown[] }
    const declinePost = doc.paths?.['/invitations/decline']?.post as { security?: unknown[] }
    const signupPost = doc.paths?.['/invitations/signup']?.post as { security?: unknown[] }
    expect(getDetail.security).toBeUndefined()
    expect(declinePost.security).toBeUndefined()
    expect(signupPost.security).toBeUndefined()
  })

  test('response DTO / request body / error response がschema参照になっている', async () => {
    const doc = await fetchOpenApiDoc()

    // getDetailの200はInvitationDetail、主要エラーは共通ErrorResponseを参照する
    const getDetail = doc.paths?.['/invitations/{token}']?.get as {
      responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>
    }
    expect(getDetail.responses['200'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/InvitationDetail')
    expect(getDetail.responses['404'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/ErrorResponse')

    // acceptの201はMember DTOを参照する
    const acceptPost = doc.paths?.['/invitations/accept']?.post as {
      responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>
    }
    expect(acceptPost.responses['201'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/Member')

    // signupの201はAuthResult DTOを参照する
    const signupPost = doc.paths?.['/invitations/signup']?.post as {
      responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>
    }
    expect(signupPost.responses['201'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/AuthResult')

    // component schemasが登録されている
    expect(doc.components?.schemas?.InvitationDetail).toBeDefined()
    expect(doc.components?.schemas?.Member).toBeDefined()
    expect(doc.components?.schemas?.AuthResult).toBeDefined()
    expect(doc.components?.schemas?.ErrorResponse).toBeDefined()
  })

  test('accept/decline/signupのrequestBodyが必須になっている', async () => {
    const doc = await fetchOpenApiDoc()

    const acceptPost = doc.paths?.['/invitations/accept']?.post as { requestBody?: { required?: boolean } }
    const declinePost = doc.paths?.['/invitations/decline']?.post as { requestBody?: { required?: boolean } }
    const signupPost = doc.paths?.['/invitations/signup']?.post as { requestBody?: { required?: boolean } }
    expect(acceptPost.requestBody?.required).toBe(true)
    expect(declinePost.requestBody?.required).toBe(true)
    expect(signupPost.requestBody?.required).toBe(true)
  })

  test('declineは204の無内容応答が定義されている', async () => {
    const doc = await fetchOpenApiDoc()

    const declinePost = doc.paths?.['/invitations/decline']?.post as { responses: Record<string, unknown> }
    expect(declinePost.responses['204']).toBeDefined()
  })

  test('/{token} のパスパラメータが定義されている', async () => {
    const doc = await fetchOpenApiDoc()

    const getDetail = doc.paths?.['/invitations/{token}']?.get as {
      parameters?: { name: string; in: string; required?: boolean }[]
    }
    const tokenParam = getDetail.parameters?.find((p) => p.name === 'token')
    expect(tokenParam?.in).toBe('path')
    expect(tokenParam?.required).toBe(true)
  })
})
