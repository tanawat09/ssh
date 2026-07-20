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
export interface DeleteServerExecutor {
  execute(serverId: string, context: { actor: string; sourceIp?: string }): void
}

export function registerServerRoute(
  app: FastifyInstance,
  createServerService: CreateServerExecutor | undefined,
  listServerService?: ListServerExecutor,
  deleteServerService?: DeleteServerExecutor,
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
  if (deleteServerService !== undefined) {
    app.delete<{ Params: { serverId: string } }>(
      '/api/v1/servers/:serverId',
      {
        preHandler: requirePermission('servers:delete'),
        schema: {
          params: {
            type: 'object',
            additionalProperties: false,
            required: ['serverId'],
            properties: {
              serverId: { type: 'string', minLength: 1, maxLength: 128 },
            },
          },
          response: {
            204: { type: 'null' },
            401: ApiErrorSchema,
            403: ApiErrorSchema,
            404: ApiErrorSchema,
            409: ApiErrorSchema,
            500: ApiErrorSchema,
          },
        },
      },
      (request, reply) => {
        deleteServerService.execute(request.params.serverId, {
          actor: 'admin',
          sourceIp: request.ip,
        })
        return reply.status(204).send()
      },
    )
  }
}
