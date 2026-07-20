import { ApiErrorCode } from '@remote/shared'
import type { preHandlerAsyncHookHandler } from 'fastify'

import { ApplicationError } from '../domain/application-error.js'

export type Role = 'admin'
export type Permission =
  'servers:create' | 'servers:read' | 'servers:connect' | 'servers:delete'

const permissionsByRole = {
  admin: new Set<Permission>([
    'servers:create',
    'servers:read',
    'servers:connect',
    'servers:delete',
  ]),
} satisfies Record<Role, ReadonlySet<Permission>>

interface JwtPayload {
  sub: string
  role: string
}

function isRole(value: string): value is Role {
  return value === 'admin'
}

export function requirePermission(
  permission: Permission,
): preHandlerAsyncHookHandler {
  return async (request) => {
    let payload: JwtPayload
    try {
      payload = await request.jwtVerify<JwtPayload>()
    } catch {
      throw new ApplicationError(
        ApiErrorCode.UNAUTHENTICATED,
        401,
        'Authentication required',
      )
    }

    if (
      payload.sub !== 'admin' ||
      !isRole(payload.role) ||
      !permissionsByRole[payload.role].has(permission)
    ) {
      throw new ApplicationError(
        ApiErrorCode.FORBIDDEN,
        403,
        'Permission denied',
      )
    }
  }
}
