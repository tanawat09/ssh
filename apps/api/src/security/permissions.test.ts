import cookie from '@fastify/cookie'
import jwt from '@fastify/jwt'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'

import { ApplicationError } from '../domain/application-error.js'
import { requirePermission } from './permissions.js'

const apps: FastifyInstance[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

function createApp() {
  const app = Fastify()
  apps.push(app)
  void app.register(cookie)
  void app.register(jwt, {
    secret: 'a-secure-test-jwt-secret-with-32-bytes',
    cookie: { cookieName: 'remote_session', signed: false },
    sign: { algorithm: 'HS256', expiresIn: 3600 },
  })
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApplicationError) {
      return reply.status(error.statusCode).send(error.toApiError())
    }
    return reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  })
  app.get(
    '/protected',
    { preHandler: requirePermission('servers:create') },
    () => ({ ok: true }),
  )
  return app
}

describe('requirePermission', () => {
  it('rejects a request without the JWT cookie', async () => {
    const response = await createApp().inject({
      method: 'GET',
      url: '/protected',
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    })
  })

  it('allows an admin JWT to use servers:create', async () => {
    const app = createApp()
    await app.ready()
    const token = app.jwt.sign({ sub: 'admin', role: 'admin' })

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { cookie: `remote_session=${token}` },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true })
  })

  it('rejects a valid JWT whose role has no mapped permission', async () => {
    const app = createApp()
    await app.ready()
    const token = app.jwt.sign({ sub: 'viewer', role: 'viewer' })

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { cookie: `remote_session=${token}` },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({
      error: { code: 'FORBIDDEN', message: 'Permission denied' },
    })
  })
})
