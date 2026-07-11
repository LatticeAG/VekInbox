export const ERROR_CODES = {
  UNAUTHORIZED: "unauthorized",
  FORBIDDEN: "forbidden",
  NOT_FOUND: "not_found",
  VALIDATION_ERROR: "validation_error",
  CONFLICT: "conflict",
  REQUEST_ALREADY_RESOLVED: "request_already_resolved",
  REQUEST_NOT_RESOLVABLE: "request_not_resolvable",
  INVALID_ACTION: "invalid_action",
  INVALID_API_KEY: "invalid_api_key",
  WORKSPACE_NOT_FOUND: "workspace_not_found",
  AGENT_NOT_FOUND: "agent_not_found",
  INTERNAL_ERROR: "internal_error",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

const DOCS_BASE = "https://latticeag.com/docs/vekinbox/errors";

export class VekInboxError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly docsUrl: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    status: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "VekInboxError";
    this.code = code;
    this.status = status;
    this.docsUrl = `${DOCS_BASE}/${code}`;
    this.details = details;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        docs_url: this.docsUrl,
        ...this.details,
      },
    };
  }
}

export function unauthorized(message = "Unauthorized"): VekInboxError {
  return new VekInboxError(ERROR_CODES.UNAUTHORIZED, message, 401);
}

export function forbidden(message = "Forbidden"): VekInboxError {
  return new VekInboxError(ERROR_CODES.FORBIDDEN, message, 403);
}

export function notFound(resource: string, id?: string): VekInboxError {
  const message = id ? `${resource} ${id} not found` : `${resource} not found`;
  return new VekInboxError(ERROR_CODES.NOT_FOUND, message, 404, id ? { [`${resource.toLowerCase()}_id`]: id } : undefined);
}

export function validationError(message: string, details?: Record<string, unknown>): VekInboxError {
  return new VekInboxError(ERROR_CODES.VALIDATION_ERROR, message, 400, details);
}

export function requestAlreadyResolved(requestId: string, status: string): VekInboxError {
  return new VekInboxError(
    ERROR_CODES.REQUEST_ALREADY_RESOLVED,
    `Request ${requestId} is already ${status}`,
    409,
    { request_id: requestId },
  );
}

export function requestNotResolvable(requestId: string, status: string): VekInboxError {
  return new VekInboxError(
    ERROR_CODES.REQUEST_NOT_RESOLVABLE,
    `Request ${requestId} cannot be resolved (status: ${status})`,
    409,
    { request_id: requestId },
  );
}

export function invalidAction(requestId: string, action: string): VekInboxError {
  return new VekInboxError(
    ERROR_CODES.INVALID_ACTION,
    `Action '${action}' is not allowed for request ${requestId}`,
    400,
    { request_id: requestId, action },
  );
}

export function invalidApiKey(): VekInboxError {
  return new VekInboxError(ERROR_CODES.INVALID_API_KEY, "Invalid or revoked API key", 401);
}
