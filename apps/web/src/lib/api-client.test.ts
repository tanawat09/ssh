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
