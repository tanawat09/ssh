import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createServer, type Server as NetServer, type Socket } from 'node:net'

import { type CreateServerRequest } from '@remote/shared'
import { Client, Server, utils, type Connection } from 'ssh2'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApplicationError } from '../domain/application-error.js'
import { Ssh2Gateway } from './ssh-gateway.js'

const username = 'deploy'
const password = 'correct-password'
const keyPassphrase = 'correct-key-passphrase'
const hostKey = utils.generateKeyPairSync('rsa', { bits: 2048 })
const clientKey = utils.generateKeyPairSync('rsa', { bits: 2048 })
const encryptedClientKey = utils.generateKeyPairSync('rsa', {
  bits: 2048,
  cipher: 'aes256-ctr',
  passphrase: keyPassphrase,
  rounds: 16,
})

const parsedHostKey = utils.parseKey(hostKey.private)
const parsedClientKey = utils.parseKey(clientKey.private)
const parsedEncryptedClientKey = utils.parseKey(
  encryptedClientKey.private,
  keyPassphrase,
)

if (
  parsedHostKey instanceof Error ||
  parsedClientKey instanceof Error ||
  parsedEncryptedClientKey instanceof Error
) {
  throw new Error('Unable to parse generated SSH test key')
}

const hostKeyBlob = parsedHostKey.getPublicSSH()
const clientKeyBlob = parsedClientKey.getPublicSSH()
const encryptedClientKeyBlob = parsedEncryptedClientKey.getPublicSSH()

interface RunningSshServer {
  close(): Promise<void>
  port: number
  waitForConnectionClose(): Promise<void>
}

function makeRequest(
  credential:
    | { authType: 'password'; password: string }
    | { authType: 'privateKey'; privateKey: string; passphrase?: string },
  port: number,
): CreateServerRequest {
  return {
    name: 'Deployment',
    host: '127.0.0.1',
    port,
    username,
    ...credential,
  }
}

async function listen(server: NetServer): Promise<number> {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Test server did not bind a TCP port')
  }
  return address.port
}

async function closeServer(
  server: NetServer,
  connections: ReadonlySet<Connection> = new Set(),
): Promise<void> {
  for (const connection of connections) {
    connection.end()
  }
  server.close()
  await once(server, 'close')
}

async function startSshServer(): Promise<RunningSshServer> {
  const connections = new Set<Connection>()
  let resolveConnectionClose: () => void = () => undefined
  const connectionClosed = new Promise<void>((resolve) => {
    resolveConnectionClose = resolve
  })
  const server = new Server({ hostKeys: [hostKey.private] }, (connection) => {
    connections.add(connection)
    connection.once('close', () => {
      connections.delete(connection)
      resolveConnectionClose()
    })
    connection.on('authentication', (context) => {
      const validPassword =
        context.method === 'password' &&
        context.username === username &&
        context.password === password
      const validPublicKey =
        context.method === 'publickey' &&
        context.username === username &&
        (context.key.data.equals(clientKeyBlob) ||
          context.key.data.equals(encryptedClientKeyBlob))

      if (validPassword || validPublicKey) {
        context.accept()
        return
      }
      context.reject()
    })
  })

  return {
    port: await listen(server),
    close: () => closeServer(server, connections),
    waitForConnectionClose: async () => {
      let guard: NodeJS.Timeout | undefined
      try {
        await Promise.race([
          connectionClosed,
          new Promise<never>((_resolve, reject) => {
            guard = setTimeout(() => {
              reject(new Error('SSH client connection remained open'))
            }, 1_000)
          }),
        ])
      } finally {
        if (guard !== undefined) {
          clearTimeout(guard)
        }
      }
    },
  }
}

async function startSilentServer(): Promise<{
  close(): Promise<void>
  port: number
}> {
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })

  return {
    port: await listen(server),
    close: async () => {
      for (const socket of sockets) {
        socket.destroy()
      }
      server.close()
      await once(server, 'close')
    },
  }
}

async function unusedPort(): Promise<number> {
  const server = createServer()
  const port = await listen(server)
  server.close()
  await once(server, 'close')
  return port
}

afterEach(() => {
  vi.restoreAllMocks()
})

function gatewayWithEndSpy(): {
  end: ReturnType<typeof vi.fn>
  gateway: Ssh2Gateway
} {
  const end = vi.fn()
  const gateway = new Ssh2Gateway(() => {
    const client = new Client()
    const originalEnd = client.end.bind(client)
    vi.spyOn(client, 'end').mockImplementation(() => {
      end()
      return originalEnd()
    })
    return client
  })
  return { end, gateway }
}

describe('SshGateway', () => {
  it('authenticates with a password and captures the TOFU host key', async () => {
    const server = await startSshServer()
    const { end, gateway } = gatewayWithEndSpy()

    try {
      const result = await gateway.testConnection(
        makeRequest({ authType: 'password', password }, server.port),
        1_000,
      )

      expect(result).toEqual({
        algorithm: 'ssh-rsa',
        fingerprint: `SHA256:${createHash('sha256')
          .update(hostKeyBlob)
          .digest('base64')
          .replace(/=+$/, '')}`,
        keyBase64: hostKeyBlob.toString('base64'),
      })
      expect(end).toHaveBeenCalledTimes(1)
    } finally {
      await server.close()
    }
  })

  it('authenticates with a private key', async () => {
    const server = await startSshServer()
    const { end, gateway } = gatewayWithEndSpy()

    try {
      await expect(
        gateway.testConnection(
          makeRequest(
            { authType: 'privateKey', privateKey: clientKey.private },
            server.port,
          ),
          1_000,
        ),
      ).resolves.toMatchObject({ keyBase64: hostKeyBlob.toString('base64') })
      expect(end).toHaveBeenCalledTimes(1)
    } finally {
      await server.close()
    }
  })

  it('authenticates with an encrypted private key and passphrase', async () => {
    const server = await startSshServer()
    const { end, gateway } = gatewayWithEndSpy()

    try {
      await expect(
        gateway.testConnection(
          makeRequest(
            {
              authType: 'privateKey',
              privateKey: encryptedClientKey.private,
              passphrase: keyPassphrase,
            },
            server.port,
          ),
          1_000,
        ),
      ).resolves.toMatchObject({ keyBase64: hostKeyBlob.toString('base64') })
      expect(end).toHaveBeenCalledTimes(1)
    } finally {
      await server.close()
    }
  })

  it('maps rejected credentials to the stable authentication error', async () => {
    const server = await startSshServer()
    const { end, gateway } = gatewayWithEndSpy()

    try {
      await expect(
        gateway.testConnection(
          makeRequest({ authType: 'password', password: 'wrong' }, server.port),
          1_000,
        ),
      ).rejects.toMatchObject({
        code: 'SSH_AUTHENTICATION_FAILED',
        message: 'SSH authentication failed',
        name: 'ApplicationError',
        statusCode: 422,
      } satisfies Partial<ApplicationError>)
      await server.waitForConnectionClose()
      expect(end).toHaveBeenCalledTimes(1)
    } finally {
      await server.close()
    }
  })

  it('maps a refused connection to the stable connection error', async () => {
    const { end, gateway } = gatewayWithEndSpy()

    await expect(
      gateway.testConnection(
        makeRequest({ authType: 'password', password }, await unusedPort()),
        1_000,
      ),
    ).rejects.toMatchObject({
      code: 'SSH_CONNECTION_FAILED',
      message: 'SSH connection failed',
      name: 'ApplicationError',
      statusCode: 502,
    } satisfies Partial<ApplicationError>)
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('maps an unresponsive endpoint to the stable timeout error', async () => {
    const server = await startSilentServer()
    const { end, gateway } = gatewayWithEndSpy()

    try {
      await expect(
        gateway.testConnection(
          makeRequest({ authType: 'password', password }, server.port),
          25,
        ),
      ).rejects.toMatchObject({
        code: 'SSH_TIMEOUT',
        message: 'SSH connection timed out',
        name: 'ApplicationError',
        statusCode: 504,
      } satisfies Partial<ApplicationError>)
      expect(end).toHaveBeenCalledTimes(1)
    } finally {
      await server.close()
    }
  })
})
