import cookie from '@fastify/cookie'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import { ApiErrorCode } from '@remote/shared'
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
} from 'fastify'

import { registerAuthRoute } from './auth/auth-route.js'
import type { AppConfig } from './config.js'
import { ApplicationError } from './domain/application-error.js'

export interface BuildAppOptions {
  config: AppConfig
}

const stateChangingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const maxRateLimitKeys = 5_000

class RollingWindowStore {
  private readonly attemptsByKey = new Map<string, number[]>()

  incr(
    key: string,
    callback: (
      error: Error | null,
      result?: { current: number; ttl: number },
    ) => void,
    timeWindow: number,
  ): void {
    const now = Date.now()
    const attempts = (this.attemptsByKey.get(key) ?? []).filter(
      (attemptedAt) => attemptedAt > now - timeWindow,
    )

    if (
      !this.attemptsByKey.has(key) &&
      this.attemptsByKey.size >= maxRateLimitKeys
    ) {
      const oldestKey = this.attemptsByKey.keys().next().value
      if (oldestKey !== undefined) {
        this.attemptsByKey.delete(oldestKey)
      }
    }

    attempts.push(now)
    this.attemptsByKey.set(key, attempts)
    callback(null, {
      current: attempts.length,
      ttl: (attempts[0] ?? now) + timeWindow - now,
    })
  }

  child(): RollingWindowStore {
    return new RollingWindowStore()
  }
}

function sendError(error: unknown, reply: FastifyReply) {
  if (error instanceof ApplicationError) {
    return reply.status(error.statusCode).send(error.toApiError())
  }

  const fastifyError = error as FastifyError

  if (fastifyError.statusCode === 429) {
    return reply.status(429).send({
      error: {
        code: ApiErrorCode.INVALID_REQUEST,
        message: 'Too many login attempts',
      },
    })
  }

  if (fastifyError.validation !== undefined) {
    return reply.status(400).send({
      error: {
        code: ApiErrorCode.INVALID_REQUEST,
        message: 'Invalid request',
      },
    })
  }

  return reply.status(500).send({
    error: {
      code: ApiErrorCode.INTERNAL_ERROR,
      message: 'Internal server error',
    },
  })
}

export function buildApp({ config }: BuildAppOptions): FastifyInstance {
  const app = Fastify()

  app.register(cookie)
  app.register(jwt, {
    secret: config.jwtSecret,
    cookie: { cookieName: 'remote_session', signed: false },
    sign: {
      algorithm: 'HS256',
      expiresIn: config.jwtExpiresInSeconds,
    },
    verify: {
      algorithms: ['HS256'],
    },
  })
  app.register(rateLimit, { global: false, store: RollingWindowStore })

  app.addHook('onRequest', (request, _reply, done) => {
    if (
      stateChangingMethods.has(request.method) &&
      request.headers.origin !== config.allowedOrigin
    ) {
      done(
        new ApplicationError(
          ApiErrorCode.FORBIDDEN,
          403,
          'Origin is not allowed',
        ),
      )
      return
    }

    done()
  })

  app.setErrorHandler((error, _request, reply) => sendError(error, reply))
  app.register((instance, _options, done) => {
    registerAuthRoute(instance, { config })
    done()
  })

  return app
}
