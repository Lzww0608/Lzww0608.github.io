// Allow a 20,000-character translation and twenty 2,000-character review notes
// in one UTF-8 JSON request, including supplementary Chinese characters.
const maximumBodyBytes = 256 * 1024;
const bodyTimeoutMs = 10_000;
const failureLimit = 12;
const failureWindowMs = 60_000;
const maximumAddresses = 256;

class EditorRequestError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
function readJson(req) {
  if (typeof req.headers['content-type'] !== 'string'
    || !/^application\/json(?:\s*;[^\r\n]*)?$/i.test(req.headers['content-type'])) {
    throw new EditorRequestError(400, 'json_content_type_required');
  }
  const announcedLength = req.headers['content-length'];
  if (announcedLength !== undefined && Number(announcedLength) > maximumBodyBytes) {
    throw new EditorRequestError(413, 'body_too_large');
  }
  return new Promise((resolve, reject) => {
    let length = 0;
    const chunks = [];
    const timer = setTimeout(() => finish(new EditorRequestError(408, 'request_timeout')), bodyTimeoutMs);
    timer.unref();
    const cleanup = () => {
      clearTimeout(timer);
      req.off('data', onData); req.off('end', onEnd); req.off('aborted', onAborted); req.off('error', onError);
    };
    const finish = (error, value) => {
      cleanup();
      if (error) reject(error); else resolve(value);
    };
    const onData = chunk => {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      length += bytes.length;
      if (length > maximumBodyBytes) finish(new EditorRequestError(413, 'body_too_large'));
      else chunks.push(bytes);
    };
    const onEnd = () => {
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length));
        const data = JSON.parse(text);
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Not an object');
        finish(null, data);
      } catch { finish(new EditorRequestError(400, 'invalid_json')); }
    };
    const onAborted = () => finish(new EditorRequestError(400, 'incomplete_request'));
    const onError = () => finish(new EditorRequestError(400, 'incomplete_request'));
    req.on('data', onData); req.once('end', onEnd); req.once('aborted', onAborted); req.once('error', onError);
  });
}

export function createEditorHandler({ editor, allowedOrigins, log = console.error }) {
  const origins = new Set(allowedOrigins ?? []);
  const failedAuthentication = new Map();
  const limitedFailure = address => {
    const now = Date.now();
    for (const [key, state] of failedAuthentication) {
      if (now - state.started >= failureWindowMs) failedAuthentication.delete(key);
    }
    let state = failedAuthentication.get(address);
    if (!state) {
      if (failedAuthentication.size >= maximumAddresses) failedAuthentication.delete(failedAuthentication.keys().next().value);
      state = { started: now, attempts: 0 };
      failedAuthentication.set(address, state);
    }
    state.attempts++;
    return { limited: state.attempts > failureLimit, retryAfter: Math.max(1, Math.ceil((failureWindowMs - (now - state.started)) / 1000)) };
  };
  const logFailure = error => {
    const permittedNodeCodes = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN']);
    const code = typeof error?.code === 'string' && (/^[A-Z0-9]{5}$/.test(error.code) || permittedNodeCodes.has(error.code))
      ? error.code : 'internal_error';
    try { log(`Translation editor request failed (${code})`); } catch { /* Logging cannot change the HTTP result. */ }
  };
  return async (req, res, path) => {
    if (typeof path !== 'string' || !/^\/api\/editor(?:\/|$)/.test(path)) return false;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    const send = (status, value) => {
      if (res.writableEnded || res.destroyed) return;
      if (status >= 400 && req.method === 'POST' && !req.complete) {
        // A rejected or oversized stream cannot hold this connection indefinitely.
        res.setHeader('Connection', 'close'); req.resume();
      }
      res.statusCode = status;
      res.end(req.method === 'HEAD' || status === 204 ? undefined : JSON.stringify(value));
    };
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) { send(403, { error: 'origin_not_allowed' }); return true; }
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    const statusRoute = path === '/api/editor/status';
    const sessionRoute = path === '/api/editor/session';
    const translationRoute = path.match(/^\/api\/editor\/translations\/([a-z0-9][a-z0-9_-]{0,159})$/);
    if (!statusRoute && !sessionRoute && !translationRoute) { send(404, { error: 'not_found' }); return true; }
    if (req.method === 'OPTIONS') {
      if (!origin || !origins.has(origin)) { send(403, { error: 'origin_not_allowed' }); return true; }
      const requestedMethod = req.headers['access-control-request-method'];
      if (requestedMethod && requestedMethod !== (statusRoute ? 'GET' : 'POST')) {
        send(405, { error: 'method_not_allowed' }); return true;
      }
      const requestedHeaders = req.headers['access-control-request-headers'];
      if (requestedHeaders && requestedHeaders.split(',').some(header => !['content-type', 'authorization'].includes(header.trim().toLowerCase()))) {
        send(400, { error: 'request_header_not_allowed' }); return true;
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Max-Age', '600');
      send(204); return true;
    }
    if (statusRoute && req.method === 'GET') { send(200, { enabled: Boolean(editor) }); return true; }
    if (statusRoute || req.method !== 'POST') { send(405, { error: 'method_not_allowed' }); return true; }
    if (!origin || !origins.has(origin)) { send(403, { error: 'origin_not_allowed' }); return true; }
    if (!editor) { send(503, { error: 'editor_not_enabled' }); return true; }
    try {
      if (!editor.authenticate(req.headers.authorization)) {
        const limit = limitedFailure(req.socket.remoteAddress ?? 'unknown');
        if (limit.limited) {
          res.setHeader('Retry-After', String(limit.retryAfter));
          send(429, { error: 'authentication_rate_limited' });
        } else send(401, { error: 'authentication_required' });
        return true;
      }
      // Successful credentials bypass the failure counter, including a flooded IP.
      if (sessionRoute) { req.resume(); send(200, { authenticated: true }); return true; }
      const payload = await readJson(req);
      if (payload.paragraphId !== translationRoute[1]) { send(400, { error: 'paragraph_id_mismatch' }); return true; }
      send(200, await editor.revise(payload));
    } catch (error) {
      if (error instanceof EditorRequestError) send(error.status, { error: error.code });
      else {
        const status = error?.statusCode ?? error?.status;
        if ([400, 404, 409].includes(status)) {
          send(status, { error: { 400: 'invalid_revision', 404: 'not_found', 409: 'version_conflict' }[status] });
        } else { logFailure(error); send(503, { error: 'temporarily_unavailable' }); }
      }
    }
    return true;
  };
}
