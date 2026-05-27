import { Hono } from 'hono'

import { registerRoutes } from './routes'

export const app = new Hono()

registerRoutes(app)
