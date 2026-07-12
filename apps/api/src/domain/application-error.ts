import type { ApiError, ApiErrorCode } from '@remote/shared'

export class ApplicationError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApplicationError'
  }

  toApiError(): ApiError {
    return {
      error: {
        code: this.code,
        message: this.message,
      },
    }
  }
}
