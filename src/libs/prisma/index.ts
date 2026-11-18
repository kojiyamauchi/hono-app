import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '@/generated/prisma/client'
import { getEnvironment } from '@/utils/runtime'
import { createScopedClient } from '@/utils/runtime/scopedClient'

/** Bunの共有クライアントは最初の利用時に生成する。Workersでは必ず専用クライアントを注入する。 */
const createDefaultClient = (): PrismaClient => {
  const connectionString = getEnvironment().DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not defined')
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}

const scoped = createScopedClient(createDefaultClient)
export const prisma = scoped.client
export const runWithPrisma = scoped.run
