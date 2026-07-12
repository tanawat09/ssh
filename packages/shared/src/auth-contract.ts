import { Type, type Static } from '@sinclair/typebox'

export const LoginRequestSchema = Type.Object(
  {
    username: Type.String({ minLength: 1, maxLength: 64 }),
    password: Type.String({ minLength: 1, maxLength: 1_024 }),
  },
  { additionalProperties: false },
)

export const SessionDtoSchema = Type.Object(
  {
    user: Type.Object(
      {
        username: Type.String({ minLength: 1, maxLength: 64 }),
        role: Type.Literal('admin'),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)

export type LoginRequest = Static<typeof LoginRequestSchema>
export type SessionDto = Static<typeof SessionDtoSchema>
