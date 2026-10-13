interface PendingRead {
  controller: AbortController;
  consumers: number;
  responseReceived: boolean;
  response: Promise<Response>;
}

class PublicReadingResponseError extends Error {}
export function hasPublicReadingResponse(error: unknown): boolean {
  return error instanceof PublicReadingResponseError;
}

// Only overlapping, unauthenticated public reads share a body. Once a read has
// completed, the next navigation goes back to the server (HTTP revalidation).
// In particular a responding empty/error API can never revive an older body.
export function createPublicReadingFetcher(transport: typeof fetch): typeof fetch {
  const pending = new Map<string, PendingRead>();
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    let path: string;
    try { path = new URL(url, globalThis.location?.href ?? 'http://localhost').pathname; }
    catch { return transport(input, init); }
    const publicRead = !(input instanceof Request) && (init?.method ?? 'GET') === 'GET'
      && !new Headers(init?.headers).has('Authorization')
      && !init?.headers && !init?.body && (!init?.credentials || init.credentials === 'omit')
      && /^\/api\/(?:chapters\/[a-z0-9-]+(?:\/sentence-translations)?|people\/[a-z0-9-]+\/timeline)$/.test(path);
    if (!publicRead) return transport(input, init);
    init?.signal?.throwIfAborted();
    let entry = pending.get(url);
    if (!entry) {
      const controller = new AbortController();
      const current: PendingRead = { controller, consumers: 0, responseReceived: false, response: Promise.resolve(new Response()) };
      current.response = (async () => {
        const response = await transport(input, { ...init, cache: 'no-cache', credentials: 'omit',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
        current.responseReceived = true;
        if (response.status === 0) return response;
        try {
          const body = await response.arrayBuffer();
          return new Response([204, 205, 304].includes(response.status) ? null : body,
            { status: response.status, statusText: response.statusText, headers: response.headers });
        } catch (error) {
          // Headers were received: preserve that authority even if the body was
          // truncated. Consumers must fail validation rather than go offline.
          return new Response(new ReadableStream({ start(c) { c.error(error); } }),
            { status: response.status, statusText: response.statusText, headers: response.headers });
        }
      })().finally(() => { if (pending.get(url) === current) pending.delete(url); });
      pending.set(url, current); entry = current;
    }
    const shared = entry; shared.consumers++;
    return new Promise<Response>((resolve, reject) => {
      let done = false;
      const finish = () => {
        if (done) return false;
        done = true; init?.signal?.removeEventListener('abort', abort); shared.consumers--;
        if (!shared.consumers && pending.get(url) === shared) { pending.delete(url); shared.controller.abort(); }
        return true;
      };
      const abort = () => { if (finish()) {
        const reason = init?.signal?.reason ?? new DOMException('Aborted', 'AbortError');
        reject(shared.responseReceived && reason?.name === 'TimeoutError'
          ? new PublicReadingResponseError('Current public response body could not be verified', { cause: reason }) : reason);
      } };
      init?.signal?.addEventListener('abort', abort, { once: true });
      shared.response.then(response => { if (finish()) { try { resolve(response.clone()); } catch (error) { reject(error); } } },
        error => { if (finish()) reject(error); });
    });
  }) as typeof fetch;
}

export const publicReadingFetch = createPublicReadingFetcher((input, init) => fetch(input, init));
