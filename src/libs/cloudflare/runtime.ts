import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '@/generated/prisma/client'
import { cloudflarePassword } from '@/libs/password/cloudflare'
import { runWithPrisma } from '@/libs/prisma'
import { createSupabaseClient, runWithSupabase } from '@/libs/supabase'
import { runWithRuntime } from '@/utils/runtime'

/** HTTPに依存せず、当該リクエストの環境・Prisma・Supabaseを配線して接続を閉じる。 */
export const runCloudflareRequest = async <T>(
  bindings: Record<string, unknown> & { HYPERDRIVE: { connectionString: string } },
  callback: () => T | Promise<T>,
): Promise<T> => {
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(bindings).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  return runWithRuntime({ env, platform: 'cloudflare', password: cloudflarePassword }, async () => {
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: bindings.HYPERDRIVE.connectionString, max: 1, connectionTimeoutMillis: 10_000 }),
      errorFormat: 'minimal',
    })
    try {
      return await runWithPrisma(prisma, () => runWithSupabase(createSupabaseClient(), callback))
    } finally {
      await prisma.$disconnect()
    }
  })
}
