import { Type, type Static } from '@sinclair/typebox'
import { TypeCompiler } from '@sinclair/typebox/compiler'

import type { ApiErrorCode } from './api-error.js'

export const TERMINAL_INPUT_MAX_BYTES = 16_384

export const TerminalClientMessageSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal('input'),
      data: Type.String({ maxLength: TERMINAL_INPUT_MAX_BYTES }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('resize'),
      cols: Type.Integer({ minimum: 20, maximum: 400 }),
      rows: Type.Integer({ minimum: 5, maximum: 200 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal('disconnect') },
    { additionalProperties: false },
  ),
])

export type TerminalClientMessage = Static<typeof TerminalClientMessageSchema>

export type TerminalServerMessage =
  | { type: 'ready'; sessionId: string }
  | { type: 'error'; code: ApiErrorCode; message: string }
  | { type: 'closed'; reason: 'client' | 'ssh' | 'error' }

const clientMessageCheck = TypeCompiler.Compile(TerminalClientMessageSchema)
const textEncoder = new TextEncoder()

export function parseTerminalClientMessage(
  value: string,
): TerminalClientMessage | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return undefined
  }

  if (!clientMessageCheck.Check(parsed)) {
    return undefined
  }
  if (
    parsed.type === 'input' &&
    textEncoder.encode(parsed.data).byteLength > TERMINAL_INPUT_MAX_BYTES
  ) {
    return undefined
  }
  return parsed
}

export function serializeTerminalServerMessage(
  message: TerminalServerMessage,
): string {
  return JSON.stringify(message)
}
