import { Type, type Static } from '@sinclair/typebox'

export const ApiErrorCode = {
  INVALID_REQUEST: 'INVALID_REQUEST',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  SERVER_ALREADY_EXISTS: 'SERVER_ALREADY_EXISTS',
  SSH_AUTHENTICATION_FAILED: 'SSH_AUTHENTICATION_FAILED',
  SSH_CONNECTION_FAILED: 'SSH_CONNECTION_FAILED',
  SSH_TIMEOUT: 'SSH_TIMEOUT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode]

export const ApiErrorSchema = Type.Object(
  {
    error: Type.Object(
      {
        code: Type.Enum(ApiErrorCode),
        message: Type.String({ minLength: 1, maxLength: 1_024 }),
        fields: Type.Optional(
          Type.Record(
            Type.String({ pattern: '^(?=.{1,100}$).+$' }),
            Type.String({ minLength: 1, maxLength: 500 }),
          ),
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)

export type ApiError = Static<typeof ApiErrorSchema>
