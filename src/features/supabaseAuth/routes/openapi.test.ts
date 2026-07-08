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

describe('supabaseAuth routes OpenAPI定義', () => {
  test('/supabase-auth/signup, /login, /me が paths へ反映されている', async () => {
    const doc = await fetchOpenApiDoc()

    expect(doc.paths?.['/supabase-auth/signup']?.post).toBeDefined()
    expect(doc.paths?.['/supabase-auth/login']?.post).toBeDefined()
    expect(doc.paths?.['/supabase-auth/me']?.get).toBeDefined()
  })

  test('/me にBearer securityが付き、signup/loginには付かない', async () => {
    const doc = await fetchOpenApiDoc()

    const meGet = doc.paths?.['/supabase-auth/me']?.get as { security?: unknown[] }
    expect(meGet.security).toEqual([{ bearerAuth: [] }])

    const signupPost = doc.paths?.['/supabase-auth/signup']?.post as { security?: unknown[] }
    const loginPost = doc.paths?.['/supabase-auth/login']?.post as { security?: unknown[] }
    expect(signupPost.security).toBeUndefined()
    expect(loginPost.security).toBeUndefined()
  })

  test('request body / response がschema参照になっている', async () => {
    const doc = await fetchOpenApiDoc()

    const signupPost = doc.paths?.['/supabase-auth/signup']?.post as {
      requestBody: { content: Record<string, { schema?: { $ref?: string } }> }
      responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>
    }
    expect(signupPost.requestBody.content['application/json'].schema?.$ref).toBe('#/components/schemas/SignupRequest')
    expect(signupPost.responses['201'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/SupabaseAuthResult')

    const loginPost = doc.paths?.['/supabase-auth/login']?.post as {
      requestBody: { content: Record<string, { schema?: { $ref?: string } }> }
      responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>
    }
    expect(loginPost.requestBody.content['application/json'].schema?.$ref).toBe('#/components/schemas/LoginRequest')
    expect(loginPost.responses['200'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/SupabaseAuthResult')

    const meGet = doc.paths?.['/supabase-auth/me']?.get as {
      responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>
    }
    expect(meGet.responses['200'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/SupabaseUser')
    expect(meGet.responses['401'].content?.['application/json'].schema?.$ref).toBe('#/components/schemas/ErrorResponse')
  })

  test('component schemasが登録されている', async () => {
    const doc = await fetchOpenApiDoc()

    expect(doc.components?.schemas?.SupabaseUser).toBeDefined()
    expect(doc.components?.schemas?.SupabaseAuthResult).toBeDefined()
    expect(doc.components?.schemas?.SignupRequest).toBeDefined()
    expect(doc.components?.schemas?.LoginRequest).toBeDefined()
  })
})
