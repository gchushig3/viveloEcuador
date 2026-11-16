import { createServer } from 'node:http';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

const digest = (value) => createHash('sha256').update(value).digest();
const safeId = /^[a-zA-Z0-9_-]{8,128}$/;
const correlationPattern = /^[a-zA-Z0-9._:-]{1,128}$/;

class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function readLimited(stream, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) throw new RequestError(413, 'Payload too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createEsb(config, { logger = (entry) => console.log(JSON.stringify(entry)) } = {}) {
  const expected = digest(config.apiKey);
  return createServer(async (req, res) => {
    const started = Date.now();
    let correlationId = randomUUID();
    let providerId;
    res.on('finish', () => logger({ service: 'esb', correlationId, providerId, method: req.method, status: res.statusCode, durationMs: Date.now() - started }));
    const problem = (status, detail) => {
      if (res.destroyed) return;
      res.writeHead(status, { 'content-type': 'application/problem+json', 'x-correlation-id': correlationId });
      res.end(JSON.stringify({ type: 'about:blank', title: detail, status, correlationId }));
    };
    try {
      const supplied = req.headers['x-correlation-id'];
      if (supplied !== undefined) {
        if (typeof supplied !== 'string' || !correlationPattern.test(supplied)) throw new RequestError(400, 'Invalid X-Correlation-Id');
        correlationId = supplied;
      }
      res.setHeader('x-correlation-id', correlationId);
      if (req.method === 'GET' && req.url === '/health/live') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'UP' }));
        return;
      }
      const key = req.headers['x-api-key'];
      if (typeof key !== 'string' || key.length > 4096 || !timingSafeEqual(expected, digest(key)))
        throw new RequestError(401, 'Invalid API key');
      // Match the raw path: encoded slashes, traversal and arbitrary destinations are never accepted.
      const match = /^\/api\/v1\/providers\/([a-zA-Z0-9_-]{1,100})\/reservations(?:\/([a-zA-Z0-9_-]{1,128})\/(cancel|checkin))?$/.exec(req.url);
      if (!match || req.method !== 'POST') throw new RequestError(404, 'Unknown ESB route');
      providerId = match[1];
      const provider = config.providers.get(providerId);
      if (!provider) throw new RequestError(404, 'Unknown provider');
      const idempotencyKey = req.headers['idempotency-key'];
      if (typeof idempotencyKey !== 'string' || !safeId.test(idempotencyKey)) throw new RequestError(400, 'Invalid Idempotency-Key');
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw new RequestError(415, 'Expected application/json');
      const body = await readLimited(req, config.maxBodyBytes);
      let parsed;
      try { parsed = JSON.parse(body.toString('utf8')); } catch { throw new RequestError(400, 'Invalid JSON'); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new RequestError(400, 'Expected JSON object');
      const suffix = match[2] ? `/${match[2]}/${match[3]}` : '';
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), config.timeoutMs);
      const disconnect = () => { if (!res.writableEnded) abort.abort(); };
      res.once('close', disconnect);
      try {
        const upstream = await fetch(`${provider.baseUrlRest}/reservas${suffix}`, {
          method: 'POST', redirect: 'manual', signal: abort.signal,
          headers: { 'content-type': 'application/json', 'x-api-key': provider.apiKey, 'x-correlation-id': correlationId, 'idempotency-key': idempotencyKey },
          body,
        });
        // Never follow provider redirects or send credentials to another origin.
        if (upstream.status >= 300 && upstream.status < 400) {
          await upstream.body?.cancel();
          throw new RequestError(502, 'Provider redirect rejected');
        }
        let responseBody;
        try { responseBody = upstream.body ? await readLimited(upstream.body, config.maxBodyBytes) : Buffer.alloc(0); }
        catch (error) { if (error.status === 413) throw new RequestError(502, 'Provider response too large'); throw error; }
        res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'x-correlation-id': correlationId });
        res.end(responseBody);
      } catch (error) {
        if (error instanceof RequestError) throw error;
        throw new RequestError(abort.signal.aborted ? 504 : 502, abort.signal.aborted ? 'Provider timed out; retry with the same Idempotency-Key' : 'Provider unavailable; retry with the same Idempotency-Key');
      } finally {
        clearTimeout(timer);
        res.off('close', disconnect);
      }
    } catch (error) { problem(error instanceof RequestError ? error.status : 500, error instanceof RequestError ? error.message : 'Internal ESB error'); }
  });
}
