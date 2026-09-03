// src/api/errors.ts — the one error envelope, and the two handlers that guarantee it.
//
// docs/API.md promises `{ "error": { "code", "message" } }` with the matching HTTP status for
// EVERY failure. The rule this module enforces: no route hand-writes an error body. A route
// throws an ApiError (or lets validation throw) and the handler below shapes it, so a consumer
// can always read `.error.code` — including on a 404 for a route that does not exist, which
// Fastify would otherwise answer in its own format.
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export type ErrorCode = "not_found" | "bad_request" | "unauthorized" | "rate_limited" | "internal";

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: ErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export const notFound = (message: string) => new ApiError(404, "not_found", message);
export const badRequest = (message: string) => new ApiError(400, "bad_request", message);
export const unauthorized = (message: string) => new ApiError(401, "unauthorized", message);

export type ErrorEnvelope = { error: { code: ErrorCode; message: string } };

export function envelope(code: ErrorCode, message: string): ErrorEnvelope {
  return { error: { code, message } };
}

function codeForStatus(status: number): ErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 400 && status < 500) return "bad_request";
  return "internal";
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
    reply.code(404).send(envelope("not_found", `no route for ${req.method} ${req.url.split("?")[0]}`));
  });

  app.setErrorHandler((err: unknown, req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof ApiError) {
      reply.code(err.status).send(envelope(err.code, err.message));
      return;
    }
    const fe = err as FastifyError;
    if (fe.validation || fe.code === "FST_ERR_VALIDATION") {
      reply.code(400).send(envelope("bad_request", fe.message));
      return;
    }
    const status = typeof fe.statusCode === "number" ? fe.statusCode : 500;
    if (status >= 400 && status < 500) {
      reply.code(status).send(envelope(codeForStatus(status), fe.message));
      return;
    }
    // A 500 is logged with its stack and answered without it: the stack is ours, not the consumer's.
    req.log.error({ err }, "unhandled error");
    reply.code(500).send(envelope("internal", "internal error"));
  });
}
