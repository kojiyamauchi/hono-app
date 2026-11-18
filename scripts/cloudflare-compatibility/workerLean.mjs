import { PrismaClient } from './.wrangler/prisma-lean/client.ts'
import { createLeanMeasurementWorker } from './workerLeanCommon.mjs'

export default await createLeanMeasurementWorker(PrismaClient, 'fast')
