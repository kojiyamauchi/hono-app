/** ワーカーを1回実行し、ログに例外の詳細を出さずに終了コードを設定する。 */
const run = async (): Promise<void> => {
  try {
    if (!process.env.RESEND_API_KEY?.trim() || !process.env.DATABASE_URL) {
      console.error('招待メールワーカーにはDATABASE_URLとRESEND_API_KEYが必要です')
      process.exitCode = 1
      return
    }
    const { prisma } = await import('./libs/prisma')
    try {
      const { deliverInvitationEmails } = await import('./shared/invitation/services/emailDelivery')
      console.info('招待メールワーカーが完了しました', { processed: await deliverInvitationEmails() })
    } finally {
      await prisma.$disconnect()
    }
  } catch {
    console.error('招待メールワーカーが失敗しました')
    process.exitCode = 1
  }
}

await run()

export {}
