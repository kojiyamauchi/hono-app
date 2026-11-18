import { PrismaClient } from './.wrangler/prisma-lean-small/client.ts'
import { createLeanMeasurementWorker } from './workerLeanCommon.mjs'

export default await createLeanMeasurementWorker(PrismaClient, 'small')
