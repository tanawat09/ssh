import {
  ApiErrorCode,
  type ApiError,
  type ApiErrorCode as ApiErrorCodeType,
  type CreateServerRequest,
  type LoginRequest,
  type ServerDto,
  type SessionDto,
} from '@remote/shared'

const errorCodes = new Set<string>(Object.values(ApiErrorCode))

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCodeType,
    message: string,
    readonly fields?: Readonly<Record<string, string>>,
  ) {
    super(message)
    this.name = 'ApiClientError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseError(value: unknown): ApiError | undefined {
  if (!isRecord(value) || !isRecord(value.error)) return undefined
  const { code, message, fields } = value.error
  if (
    typeof code !== 'string' ||
    !errorCodes.has(code) ||
    typeof message !== 'string'
  ) {
    return undefined
  }
  if (fields !== undefined) {
    if (
      !isRecord(fields) ||
      Object.values(fields).some((field) => typeof field !== 'string')
    ) {
      return undefined
    }
  }
  return value as ApiError
}

export class ApiClient {
  constructor(
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  login(request: LoginRequest): Promise<SessionDto> {
    return this.request('/api/v1/auth/login', request)
  }

  session(): Promise<SessionDto> {
    return this.get('/api/v1/auth/session')
  }

  createServer(request: CreateServerRequest): Promise<ServerDto> {
    return this.request('/api/v1/servers', request)
  }

  listServers(): Promise<ServerDto[]> {
    return this.get('/api/v1/servers')
  }

  deleteServer(serverId: string): Promise<void> {
    return this.delete(`/api/v1/servers/${encodeURIComponent(serverId)}`)
  }

  private async get<T>(path: string): Promise<T> {
    const response = await this.fetcher(path, {
      method: 'GET',
      credentials: 'include',
    })
    const value = await this.readJson(response)
    if (!response.ok) this.throwResponseError(response.status, value)
    return value as T
  }

  private async request<T>(path: string, body: unknown): Promise<T> {
    const response = await this.fetcher(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const value = await this.readJson(response)
    if (!response.ok) this.throwResponseError(response.status, value)
    return value as T
  }

  private async delete(path: string): Promise<void> {
    const response = await this.fetcher(path, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (response.ok) return
    const value = await this.readJson(response)
    this.throwResponseError(response.status, value)
  }

  private async readJson(response: Response): Promise<unknown> {
    if (response.status === 204) return undefined
    try {
      return await response.json()
    } catch {
      return undefined
    }
  }

  private throwResponseError(status: number, value: unknown): never {
    const parsed = parseError(value)
    throw new ApiClientError(
      status,
      parsed?.error.code ?? ApiErrorCode.INTERNAL_ERROR,
      parsed?.error.message ?? 'Request failed. Please try again.',
      parsed?.error.fields,
    )
  }
}

export const apiClient = new ApiClient()
