import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '@/generated/prisma/client'
import { getEnvironment } from '@/utils/runtime'
import { createScopedClient } from '@/utils/runtime/scopedClient'

/** Bunの共有クライアントを生成する。Workersでは必ず専用クライアントを注入する。 */
const createDefaultClient = (): PrismaClient => {
  const connectionString = getEnvironment().DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not defined')
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}

// Bunは従来どおりimport時に設定を検証する。Workersでのスコープ外利用は拒否する。
const bunClient = typeof Bun !== 'undefined' ? createDefaultClient() : undefined
const scoped = createScopedClient(() => {
  if (!bunClient) throw new Error('Cloudflareではリクエスト専用のPrismaクライアントが必要です')
  return bunClient
})
export const prisma = scoped.client
export const runWithPrisma = scoped.run
