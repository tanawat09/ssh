import argon2 from 'argon2'
import {
  ApiErrorSchema,
  LoginRequestSchema,
  SessionDtoSchema,
  type LoginRequest,
  type SessionDto,
} from '@remote/shared'
import type { FastifyInstance } from 'fastify'

import type { AppConfig } from '../config.js'
import { ApplicationError } from '../domain/application-error.js'
import { ApiErrorCode } from '@remote/shared'
import { requirePermission } from '../security/permissions.js'

interface AuthRouteOptions {
  config: AppConfig
}

async function passwordMatches(hash: string, password: string) {
  try {
    return await argon2.verify(hash, password)
  } catch {
    return false
  }
}

export function registerAuthRoute(
  app: FastifyInstance,
  { config }: AuthRouteOptions,
): void {
  app.post(
    '/api/v1/auth/login',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: 15 * 60 * 1000,
        },
      },
      schema: {
        body: LoginRequestSchema,
        response: {
          200: SessionDtoSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
          429: ApiErrorSchema,
        },
      },
    },
    async (request, reply): Promise<SessionDto> => {
      const { username, password } = request.body as LoginRequest
      const validPassword = await passwordMatches(
        config.adminPasswordHash,
        password,
      )

      if (username !== config.adminUsername || !validPassword) {
        throw new ApplicationError(
          ApiErrorCode.UNAUTHENTICATED,
          401,
          'Invalid username or password',
        )
      }

      const token = await reply.jwtSign({ sub: 'admin', role: 'admin' })
      reply.setCookie('remote_session', token, {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
        secure: config.nodeEnv === 'production',
      })

      return {
        user: {
          username: config.adminUsername,
          role: 'admin',
        },
      }
    },
  )

  app.get(
    '/api/v1/auth/session',
    {
      preHandler: requirePermission('servers:read'),
      schema: {
        response: {
          200: SessionDtoSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
        },
      },
    },
    (): SessionDto => ({
      user: { username: config.adminUsername, role: 'admin' },
    }),
  )
}
