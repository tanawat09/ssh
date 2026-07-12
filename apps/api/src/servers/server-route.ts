import {
  ApiErrorSchema,
  CreateServerRequestSchema,
  ServerDtoSchema,
  type CreateServerRequest,
  type ServerDto,
} from '@remote/shared'
import type { FastifyInstance } from 'fastify'

import { requirePermission } from '../security/permissions.js'

export interface CreateServerExecutor {
  execute(
    input: CreateServerRequest,
    context: { actor: string; sourceIp?: string },
  ): Promise<ServerDto>
}

export function registerServerRoute(
  app: FastifyInstance,
  createServerService: CreateServerExecutor,
): void {
  app.post(
    '/api/v1/servers',
    {
      preHandler: requirePermission('servers:create'),
      schema: {
        body: CreateServerRequestSchema,
        response: {
          201: ServerDtoSchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
          409: ApiErrorSchema,
          422: ApiErrorSchema,
          502: ApiErrorSchema,
          504: ApiErrorSchema,
          500: ApiErrorSchema,
        },
      },
    },
    async (request, reply): Promise<ServerDto> => {
      const result = await createServerService.execute(
        request.body as CreateServerRequest,
        { actor: 'admin', sourceIp: request.ip },
      )
      reply.status(201)
      return result
    },
  )
}
