import actionRetrier from '@convex-dev/action-retrier/convex.config'
import betterAuth from '@convex-dev/better-auth/convex.config'
import { defineApp } from 'convex/server'

const app = defineApp()

app.use(betterAuth)
app.use(actionRetrier)

export default app
