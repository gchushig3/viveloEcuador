import type { Request, Response } from 'express';
import { performance } from 'node:perf_hooks';

export function attachStructuredAccessLog(
  request: Request,
  response: Response,
): void {
  if (request.accessLogAttached) return;
  request.accessLogAttached = true;
  const startedAt = request.requestStartedAt ?? performance.now();
  let written = false;
  const write = () => {
    if (written) return;
    written = true;
    process.stdout.write(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        method: request.method,
        route: request.originalUrl.split('?')[0],
        userId: request.user?.id ?? null,
        status: response.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
        correlationId: request.correlationId ?? null,
      })}\n`,
    );
  };
  response.once('finish', write);
  response.once('close', write);
}
