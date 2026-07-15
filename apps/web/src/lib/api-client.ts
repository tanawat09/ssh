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

  createServer(request: CreateServerRequest): Promise<ServerDto> {
    return this.request('/api/v1/servers', request)
  }

  private async request<T>(path: string, body: unknown): Promise<T> {
    const response = await this.fetcher(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    let value: unknown
    try {
      value = await response.json()
    } catch {
      value = undefined
    }
    if (!response.ok) {
      const parsed = parseError(value)
      if (parsed !== undefined) {
        throw new ApiClientError(
          response.status,
          parsed.error.code,
          parsed.error.message,
          parsed.error.fields,
        )
      }
      throw new ApiClientError(
        response.status,
        ApiErrorCode.INTERNAL_ERROR,
        'Request failed. Please try again.',
      )
    }
    return value as T
  }
}

export const apiClient = new ApiClient()
