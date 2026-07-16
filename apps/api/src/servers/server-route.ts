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
export interface ListServerExecutor {
  execute(context: {
    actor: string
    sourceIp?: string
  }): Promise<ServerDto[]> | ServerDto[]
}

export function registerServerRoute(
  app: FastifyInstance,
  createServerService: CreateServerExecutor | undefined,
  listServerService?: ListServerExecutor,
): void {
  if (createServerService !== undefined)
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
  if (listServerService !== undefined) {
    app.get(
      '/api/v1/servers',
      {
        preHandler: requirePermission('servers:read'),
        schema: {
          response: {
            200: { type: 'array', items: ServerDtoSchema },
            401: ApiErrorSchema,
            403: ApiErrorSchema,
            500: ApiErrorSchema,
          },
        },
      },
      async (request) =>
        listServerService.execute({ actor: 'admin', sourceIp: request.ip }),
    )
  }
}
