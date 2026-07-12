import { Type, type Static } from '@sinclair/typebox'

const serverFields = {
  name: Type.String({ minLength: 1, maxLength: 100 }),
  host: Type.String({ minLength: 1, maxLength: 253 }),
  port: Type.Integer({ minimum: 1, maximum: 65_535 }),
  username: Type.String({ minLength: 1, maxLength: 64 }),
}

const PasswordServerRequestSchema = Type.Object(
  {
    ...serverFields,
    authType: Type.Literal('password'),
    password: Type.String({ minLength: 1, maxLength: 1_024 }),
  },
  { additionalProperties: false },
)

const PrivateKeyServerRequestSchema = Type.Object(
  {
    ...serverFields,
    authType: Type.Literal('privateKey'),
    privateKey: Type.String({ minLength: 1, maxLength: 65_536 }),
    passphrase: Type.Optional(Type.String({ minLength: 0, maxLength: 1_024 })),
  },
  { additionalProperties: false },
)

export const CreateServerRequestSchema = Type.Union([
  PasswordServerRequestSchema,
  PrivateKeyServerRequestSchema,
])

export const ServerDtoSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 128 }),
    ...serverFields,
    authType: Type.Union([
      Type.Literal('password'),
      Type.Literal('privateKey'),
    ]),
    hostKeyAlgorithm: Type.String({ minLength: 1, maxLength: 128 }),
    hostKeyFingerprint: Type.String({ minLength: 1, maxLength: 512 }),
    createdAt: Type.String({ format: 'date-time', maxLength: 35 }),
    updatedAt: Type.String({ format: 'date-time', maxLength: 35 }),
  },
  { additionalProperties: false },
)

export type CreateServerRequest = Static<typeof CreateServerRequestSchema>
export type ServerDto = Static<typeof ServerDtoSchema>
