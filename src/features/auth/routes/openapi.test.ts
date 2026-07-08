import { describe, expect, test } from 'bun:test'

// registerOpenApiRoutes は登録時に ENABLE_API_DOCS を評価するため、app import より前に有効化する。
process.env.ENABLE_API_DOCS = 'true'
process.env.JWT_SECRET = 'test-secret'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret'
process.env.PASSWORD_RESET_TOKEN_SECRET = 'test-password-reset-secret'

const { app } = await import('@/app')

/** OpenAPI JSON（/open-api/doc）を取得してパースする。 */
const fetchOpenApiDoc = async (): Promise<{
  paths?: Record<string, Record<string, unknown>>
  components?: { schemas?: Record<string, unknown>; securitySchemes?: Record<string, unknown> }
}> => {
  const response = await app.request('/open-api/doc')
  expect(response.status).toBe(200)
  return response.json()
}

describe('auth routes OpenAPI定義', () => {
  test('/auth配下の11 pathがpathsへ反映されている', async () => {
    const doc = await fetchOpenApiDoc()

    expect(doc.paths?.['/auth/signup']?.post).toBeDefined()
    expect(doc.paths?.['/auth/login']?.post).toBeDefined()
    expect(doc.paths?.['/auth/refresh']?.post).toBeDefined()
    expect(doc.paths?.['/auth/logout']?.post).toBeDefined()
    expect(doc.paths?.['/auth/me']?.get).toBeDefined()
    expect(doc.paths?.['/auth/change-password']?.post).toBeDefined()
    expect(doc.paths?.['/auth/logout-all']?.post).toBeDefined()
    expect(doc.paths?.['/auth/sessions']?.get).toBeDefined()
    expect(doc.paths?.['/auth/sessions/{id}']?.delete).toBeDefined()
    expect(doc.paths?.['/auth/password-reset/request']?.post).toBeDefined()
    expect(doc.paths?.['/auth/password-reset/confirm']?.post).toBeDefined()
  })

  test('Bearer securityが必要なendpointに付いている', async () => {
    const doc = await fetchOpenApiDoc()

    const meGet = doc.paths?.['/auth/me']?.get as { security?: unknown[] }
    expect(meGet.security).toEqual([{ bearerAuth: [] }])

    const changePasswordPost = doc.paths?.['/auth/change-password']?.post as { security?: unknown[] }
    expect(changePasswordPost.security).toEqual([{ bearerAuth: [] }])

    const logoutAllPost = doc.paths?.['/auth/logout-all']?.post as { security?: unknown[] }
    expect(logoutAllPost.security).toEqual([{ bearerAuth: [] }])

    const sessionsGet = doc.paths?.['/auth/sessions']?.get as { security?: unknown[] }
    expect(sessionsGet.security).toEqual([{ bearerAuth: [] }])

    const sessionDelete = doc.paths?.['/auth/sessions/{id}']?.delete as { security?: unknown[] }
    expect(sessionDelete.security).toEqual([{ bearerAuth: [] }])
  })

  test('Cookie securityがrefresh/logoutに付いている', async () => {
    const doc = await fetchOpenApiDoc()

    const refreshPost = doc.paths?.['/auth/refresh']?.post as { security?: unknown[] }
    expect(refreshPost.security).toEqual([{ cookieAuth: [] }])

    const logoutPost = doc.paths?.['/auth/logout']?.post as { security?: unknown[] }
    expect(logoutPost.security).toEqual([{ cookieAuth: [] }])
  })

  test('signup/login/password-reset/*にはsecurityが設定されていない', async () => {
    const doc = await fetchOpenApiDoc()

    const signupPost = doc.paths?.['/auth/signup']?.post as { security?: unknown[] }
    const loginPost = doc.paths?.['/auth/login']?.post as { security?: unknown[] }
    const resetRequestPost = doc.paths?.['/auth/password-reset/request']?.post as { security?: unknown[] }
    const resetConfirmPost = doc.paths?.['/auth/password-reset/confirm']?.post as { security?: unknown[] }

    expect(signupPost.security).toBeUndefined()
    expect(loginPost.security).toBeUndefined()
    expect(resetRequestPost.security).toBeUndefined()
    expect(resetConfirmPost.security).toBeUndefined()
  })

  test('response DTOがschema参照になっている', async () => {
    const doc = await fetchOpenApiDoc()

    const signupPost = doc.paths?.['/auth/signup']?.post as {
      responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>
    }
    expect(signupPost.responses['201'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/AuthResult')

    const meGet = doc.paths?.['/auth/me']?.get as {
      responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>
    }
    expect(meGet.responses['200'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/User')
    expect(meGet.responses['401'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/ErrorResponse')

    const sessionsGet = doc.paths?.['/auth/sessions']?.get as {
      responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>
    }
    expect(sessionsGet.responses['200'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/SessionList')
  })

  test('component schemasが登録されている', async () => {
    const doc = await fetchOpenApiDoc()

    expect(doc.components?.schemas?.AuthResult).toBeDefined()
    expect(doc.components?.schemas?.Session).toBeDefined()
    expect(doc.components?.schemas?.SessionList).toBeDefined()
    expect(doc.components?.schemas?.User).toBeDefined()
    expect(doc.components?.schemas?.ErrorResponse).toBeDefined()
  })

  test('securitySchemes.cookieAuthが登録されている', async () => {
    const doc = await fetchOpenApiDoc()

    expect(doc.components?.securitySchemes?.cookieAuth).toEqual({
      type: 'apiKey',
      in: 'cookie',
      name: 'refreshToken',
    })
  })

  test('signupのrequestBodyが必須になっている', async () => {
    const doc = await fetchOpenApiDoc()

    const signupPost = doc.paths?.['/auth/signup']?.post as { requestBody?: { required?: boolean } }
    expect(signupPost.requestBody?.required).toBe(true)
  })

  test('/auth/sessions/{id}のpathパラメータが定義されている', async () => {
    const doc = await fetchOpenApiDoc()

    const sessionDelete = doc.paths?.['/auth/sessions/{id}']?.delete as {
      parameters?: { name: string; in: string; required?: boolean }[]
    }
    const idParam = sessionDelete.parameters?.find((p) => p.name === 'id')
    expect(idParam?.in).toBe('path')
    expect(idParam?.required).toBe(true)
  })

  test('202/204の無内容応答が該当statusで定義されている', async () => {
    const doc = await fetchOpenApiDoc()

    const resetRequestPost = doc.paths?.['/auth/password-reset/request']?.post as {
      responses: Record<string, unknown>
    }
    expect(resetRequestPost.responses['202']).toBeDefined()

    const logoutPost = doc.paths?.['/auth/logout']?.post as { responses: Record<string, unknown> }
    expect(logoutPost.responses['204']).toBeDefined()

    const resetConfirmPost = doc.paths?.['/auth/password-reset/confirm']?.post as {
      responses: Record<string, unknown>
    }
    expect(resetConfirmPost.responses['204']).toBeDefined()
  })
})
