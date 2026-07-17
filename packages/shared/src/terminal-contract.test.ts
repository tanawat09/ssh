import { describe, expect, it } from 'vitest'

import {
  parseTerminalClientMessage,
  serializeTerminalServerMessage,
  TERMINAL_INPUT_MAX_BYTES,
} from './terminal-contract.js'

describe('parseTerminalClientMessage', () => {
  it.each([
    [{ type: 'input', data: 'ls -la\r' }],
    [{ type: 'resize', cols: 20, rows: 5 }],
    [{ type: 'resize', cols: 400, rows: 200 }],
    [{ type: 'disconnect' }],
  ])('accepts a valid %s message', (message) => {
    expect(parseTerminalClientMessage(JSON.stringify(message))).toEqual(message)
  })

  it.each([
    '',
    '{',
    'null',
    '[]',
    JSON.stringify({ type: 'unknown' }),
    JSON.stringify({ type: 'disconnect', reason: 'secret' }),
    JSON.stringify({ type: 'input', data: 'ls', extra: true }),
    JSON.stringify({ type: 'input', data: 42 }),
    JSON.stringify({ type: 'resize', cols: 19, rows: 24 }),
    JSON.stringify({ type: 'resize', cols: 401, rows: 24 }),
    JSON.stringify({ type: 'resize', cols: 80, rows: 4 }),
    JSON.stringify({ type: 'resize', cols: 80, rows: 201 }),
    JSON.stringify({ type: 'resize', cols: 80.5, rows: 24 }),
    JSON.stringify({ type: 'resize', cols: 80, rows: 24, extra: true }),
  ])('rejects invalid input %s', (value) => {
    expect(parseTerminalClientMessage(value)).toBeUndefined()
  })

  it('enforces the input limit in UTF-8 bytes', () => {
    const ascii = 'a'.repeat(TERMINAL_INPUT_MAX_BYTES)
    const thaiCharacterBytes = new TextEncoder().encode('ก').byteLength
    const multiByteAtLimit = 'ก'.repeat(
      Math.floor(TERMINAL_INPUT_MAX_BYTES / thaiCharacterBytes),
    )

    expect(
      parseTerminalClientMessage(
        JSON.stringify({ type: 'input', data: ascii }),
      ),
    ).toEqual({ type: 'input', data: ascii })
    expect(
      parseTerminalClientMessage(
        JSON.stringify({ type: 'input', data: `${ascii}a` }),
      ),
    ).toBeUndefined()
    expect(
      parseTerminalClientMessage(
        JSON.stringify({ type: 'input', data: multiByteAtLimit }),
      ),
    ).toEqual({ type: 'input', data: multiByteAtLimit })
    expect(
      parseTerminalClientMessage(
        JSON.stringify({ type: 'input', data: `${multiByteAtLimit}ก` }),
      ),
    ).toBeUndefined()
  })
})

describe('serializeTerminalServerMessage', () => {
  it.each([
    { type: 'ready' as const, sessionId: 'session-id' },
    {
      type: 'error' as const,
      code: 'TERMINAL_PROTOCOL_ERROR' as const,
      message: 'Invalid terminal message',
    },
    { type: 'closed' as const, reason: 'client' as const },
  ])('serializes the approved %s control message', (message) => {
    expect(serializeTerminalServerMessage(message)).toBe(JSON.stringify(message))
  })
})
