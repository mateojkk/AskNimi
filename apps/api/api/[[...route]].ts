import { handle } from 'hono/vercel'
import { app } from '../server/app'

export const maxDuration = 60

export const GET = handle(app)
export const POST = handle(app)
