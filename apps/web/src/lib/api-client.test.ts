import { ApiErrorCode } from '@remote/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiClient, ApiClientError } from './api-client'

describe('ApiClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('preserves the browser receiver for the default fetch transport', async () => {
    const receiverSensitiveFetch = vi.fn(function (
      this: typeof globalThis,
    ): Promise<Response> {
      if (this !== globalThis) throw new TypeError('Illegal invocation')
      return Promise.resolve(
        new Response(
          JSON.stringify({ user: { username: 'admin', role: 'admin' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
    }) as unknown as typeof fetch
    vi.stubGlobal('fetch', receiverSensitiveFetch)

    await expect(
      new ApiClient().login({ username: 'admin', password: 'secret' }),
    ).resolves.toEqual({ user: { username: 'admin', role: 'admin' } })
  })

  it('uses same-origin credentialed requests', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ user: { username: 'admin', role: 'admin' } }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )

    await new ApiClient(fetcher).login({
      username: 'admin',
      password: 'secret',
    })

    expect(fetcher).toHaveBeenCalledWith('/api/v1/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'secret' }),
    })
  })

  it('lists servers with a credentialed GET and no body', async () => {
    const server = {
      id: 'server-1',
      name: 'Production',
      host: 'server.example.com',
      port: 22,
      username: 'deploy',
      authType: 'password' as const,
      hostKeyAlgorithm: 'ssh-ed25519',
      hostKeyFingerprint: 'SHA256:server',
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
    }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([server]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await expect(new ApiClient(fetcher).listServers()).resolves.toEqual([
      server,
    ])
    expect(fetcher).toHaveBeenCalledWith('/api/v1/servers', {
      method: 'GET',
      credentials: 'include',
    })
  })

  it('deletes an encoded server ID with credentials and accepts an empty response', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }))

    await expect(
      new ApiClient(fetcher).deleteServer('server/id'),
    ).resolves.toBeUndefined()
    expect(fetcher).toHaveBeenCalledWith('/api/v1/servers/server%2Fid', {
      method: 'DELETE',
      credentials: 'include',
    })
  })

  it('parses active-session conflicts from delete responses', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: ApiErrorCode.SERVER_HAS_ACTIVE_SESSION,
            message: 'Server has an active terminal session',
          },
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      ),
    )

    await expect(
      new ApiClient(fetcher).deleteServer('server-1'),
    ).rejects.toEqual(
      new ApiClientError(
        409,
        ApiErrorCode.SERVER_HAS_ACTIVE_SESSION,
        'Server has an active terminal session',
      ),
    )
  })

  it('parses typed API errors', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: ApiErrorCode.INVALID_REQUEST,
            message: 'Invalid request',
            fields: { host: 'Enter a valid host' },
          },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    )

    await expect(
      new ApiClient(fetcher).createServer({
        name: 'Production',
        host: 'bad host',
        port: 22,
        username: 'deploy',
        authType: 'password',
        password: 'secret',
      }),
    ).rejects.toEqual(
      new ApiClientError(400, ApiErrorCode.INVALID_REQUEST, 'Invalid request', {
        host: 'Enter a valid host',
      }),
    )
  })

  it('uses a generic error when the response body is not a valid envelope', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('<html>proxy error</html>', { status: 502 }),
      )

    await expect(
      new ApiClient(fetcher).login({ username: 'admin', password: 'secret' }),
    ).rejects.toMatchObject({
      status: 502,
      code: ApiErrorCode.INTERNAL_ERROR,
      message: 'Request failed. Please try again.',
    })
  })
})
