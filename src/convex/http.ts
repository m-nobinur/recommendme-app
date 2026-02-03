import { httpRouter } from 'convex/server'
import { authComponent, createAuth } from './auth'

const http = httpRouter()

/**
 * Register Better Auth routes
 * This enables authentication endpoints on the Convex backend
 */
authComponent.registerRoutes(http, createAuth)

export default http
