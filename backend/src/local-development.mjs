const loopbackAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export const localDevelopmentOrigins = Object.freeze([
  'http://localhost:5173', 'http://127.0.0.1:5173',
  'http://localhost:4173', 'http://127.0.0.1:4173',
]);

export function resolveLocalDevelopment(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => key !== 'port')
    || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535 || value.port === 8787) {
    throw new TypeError('A separate valid development port is required; production port 8787 is forbidden.');
  }
  return Object.freeze({ port: value.port });
}

// This intentionally ignores environment variables and forwarded addresses.
// Both the real socket and the browser's exact local origin must agree.
export function localDevelopmentRequestFailure(req, development, origins) {
  if (!development) return null;
  if (!loopbackAddresses.has(req.socket?.remoteAddress)
    || !loopbackAddresses.has(req.socket?.localAddress)
    || req.socket.localPort !== development.port) return 'loopback_request_required';
  const names = Object.keys(req.headers);
  if (names.some(name => name === 'forwarded' || name === 'via' || name.startsWith('x-forwarded-'))) {
    return 'proxy_request_not_allowed';
  }
  const host = req.headers.host;
  if (host !== `127.0.0.1:${development.port}` && host !== `localhost:${development.port}`) {
    return 'host_not_allowed';
  }
  const rawHeaders = req.rawHeaders ?? [];
  let hostCount = 0;
  for (let i = 0; i < rawHeaders.length; i += 2) if (rawHeaders[i].toLowerCase() === 'host') hostCount++;
  if (hostCount !== 1) return 'host_not_allowed';
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || !localDevelopmentOrigins.includes(origin) || !origins.has(origin)) {
    return 'origin_not_allowed';
  }
  return null;
}
