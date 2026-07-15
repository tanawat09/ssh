import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { createReadStream, mkdtempSync, rmSync, statSync } from 'node:fs'
import {
  createServer as createHttpServer,
  request as httpRequest,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { extname, join, normalize } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'

import argon2 from 'argon2'
import ssh2, { type Server as SshServer } from 'ssh2'

const adminPassword = 'e2e-admin-password'
const sshUsername = 'e2e-ssh-user'
const sshPassword = 'e2e-ssh-password'
const webOrigin = 'http://127.0.0.1:4173'
const apiPort = 3000

function rsaPrivateKey(): string {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { format: 'pem', type: 'pkcs1' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  })
  return privateKey
}

function listen(server: SshServer): Promise<number> {
  server.listen(0, '127.0.0.1')
  return once(server, 'listening').then(
    () => (server.address() as AddressInfo).port,
  )
}

function waitForHttp(url: string, child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 15_000
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    const check = (): void => {
      if (child.exitCode !== null) {
        reject(new Error(`API exited during startup: ${stderr.trim()}`))
        return
      }
      const request = httpRequest(url, (response) => {
        response.resume()
        resolve()
      })
      request.once('error', () => {
        if (Date.now() >= deadline) {
          reject(
            new Error(`API did not start before timeout: ${stderr.trim()}`),
          )
        } else {
          setTimeout(check, 100)
        }
      })
      request.end()
    }
    check()
  })
}

function contentType(path: string): string {
  return (
    {
      '.css': 'text/css; charset=utf-8',
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.svg': 'image/svg+xml',
    }[extname(path)] ?? 'application/octet-stream'
  )
}

function startWebServer() {
  const distDirectory = join(process.cwd(), 'apps/web/dist')
  const server = createHttpServer((request, response) => {
    if (request.url?.startsWith('/api/') === true) {
      const upstream = httpRequest(
        {
          host: '127.0.0.1',
          port: apiPort,
          path: request.url,
          method: request.method,
          headers: request.headers,
        },
        (upstreamResponse) => {
          response.writeHead(
            upstreamResponse.statusCode ?? 502,
            upstreamResponse.headers,
          )
          upstreamResponse.pipe(response)
        },
      )
      upstream.once('error', () => {
        response.writeHead(502).end('Bad gateway')
      })
      request.pipe(upstream)
      return
    }

    const requestPath = new URL(request.url ?? '/', webOrigin).pathname
    const relativePath = normalize(requestPath).replace(/^[/\\]+/, '')
    let filePath = join(distDirectory, relativePath)
    try {
      if (requestPath === '/' || !statSync(filePath).isFile()) {
        filePath = join(distDirectory, 'index.html')
      }
    } catch {
      filePath = join(distDirectory, 'index.html')
    }
    response.setHeader('content-type', contentType(filePath))
    createReadStream(filePath).pipe(response)
  })
  server.listen(4173, '127.0.0.1')
  return once(server, 'listening').then(() => server)
}

async function terminate(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  const exited = await Promise.race([
    once(child, 'exit').then(() => true),
    new Promise<false>((resolve) =>
      setTimeout(() => {
        resolve(false)
      }, 5_000),
    ),
  ])
  if (!exited) child.kill('SIGKILL')
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const hostKey = rsaPrivateKey()
  const clientKey = rsaPrivateKey()
  const parsedClientKey = ssh2.utils.parseKey(clientKey)
  if (parsedClientKey instanceof Error) throw parsedClientKey
  const clientPublicSsh = parsedClientKey.getPublicSSH()

  const sshServer = new ssh2.Server({ hostKeys: [hostKey] }, (client) => {
    client.on('authentication', (context) => {
      if (context.username !== sshUsername) {
        context.reject()
        return
      }
      if (context.method === 'password') {
        if (context.password === sshPassword) {
          context.accept()
        } else {
          context.reject()
        }
        return
      }
      if (
        context.method === 'publickey' &&
        context.key.data.equals(clientPublicSsh)
      ) {
        if (context.signature === undefined) {
          context.accept()
          return
        }
        const validSignature =
          context.blob !== undefined &&
          parsedClientKey.verify(
            context.blob,
            context.signature,
            context.hashAlgo,
          )
        if (validSignature) {
          context.accept()
        } else {
          context.reject()
        }
        return
      }
      context.reject()
    })
  })
  const sshPort = await listen(sshServer)

  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'remote-e2e-'))
  const adminPasswordHash = await argon2.hash(adminPassword, {
    type: argon2.argon2id,
  })
  const api = spawn(process.execPath, ['apps/api/dist/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD_HASH: adminPasswordHash,
      JWT_SECRET: randomBytes(48).toString('base64'),
      CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      ALLOWED_ORIGIN: webOrigin,
      DATABASE_PATH: join(temporaryDirectory, 'remote.sqlite'),
      SSH_CONNECT_TIMEOUT_MS: '3000',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })

  try {
    await waitForHttp(`http://127.0.0.1:${String(apiPort)}/health`, api)
    const webServer = await startWebServer()
    process.env.E2E_SSH_PORT = String(sshPort)
    process.env.E2E_SSH_PRIVATE_KEY = clientKey

    return async () => {
      await new Promise<void>((resolve, reject) => {
        webServer.close((error) => {
          if (error === undefined) resolve()
          else reject(error)
        })
      })
      await new Promise<void>((resolve, reject) => {
        sshServer.close((error) => {
          if (error === undefined) resolve()
          else reject(error)
        })
      })
      await terminate(api)
      rmSync(temporaryDirectory, { force: true, recursive: true })
    }
  } catch (error) {
    sshServer.close()
    await terminate(api)
    rmSync(temporaryDirectory, { force: true, recursive: true })
    throw error
  }
}
