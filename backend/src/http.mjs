import { createServer } from 'node:http';
import { createEditorHandler } from './editor-http.mjs';
export function createApi({ repository, allowedOrigins, editor = null, log = console.error }) {
  const origins = new Set(allowedOrigins);
  const handleEditor = createEditorHandler({editor, allowedOrigins, log});
  return createServer({ requestTimeout: 10_000, headersTimeout: 10_000, maxHeaderSize: 8192 }, async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Origin');
    const send = (status, data) => { res.statusCode = status; res.end(req.method === 'HEAD' ? undefined : JSON.stringify(data)); };
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) return send(403, { error: 'origin_not_allowed' });
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Allow', 'GET, HEAD, OPTIONS');
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = decodeURIComponent(url.pathname);
      if (await handleEditor(req,res,path)) return;
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Max-Age', '600');
        res.statusCode = 204; return res.end();
      }
      if (!['GET', 'HEAD'].includes(req.method)) return send(405, { error: 'method_not_allowed' });
      if (path === '/api/health') return send(200, await repository.health());
      if (path === '/api/books') return send(200, { books: await repository.books() });
      const chapters = path.match(/^\/api\/books\/([a-z0-9-]+)\/chapters$/);
      if (chapters) {
        const result = await repository.chapters(chapters[1]);
        return result ? send(200, { chapters: result }) : send(404, { error: 'not_found' });
      }
      const chapter = path.match(/^\/api\/chapters\/([a-z0-9-]+)$/);
      if (chapter) {
        const result = await repository.chapter(chapter[1]);
        return result ? send(200, result) : send(404, { error: 'not_found' });
      }
      if (path === '/api/search') {
        const q = (url.searchParams.get('q') || '').trim();
        if (!q || q.length > 100) return send(400, { error: 'query_must_be_1_to_100_characters' });
        return send(200, { results: await repository.search(q) });
      }
      return send(404, { error: 'not_found' });
    } catch (error) {
      if (error instanceof URIError || error instanceof TypeError) return send(400, { error: 'invalid_request' });
      // Do not log request contents, credentials, SQL or connection details.
      log(`API request failed (${error.code || 'internal_error'})`);
      return send(503, { error: 'temporarily_unavailable' });
    }
  });
}
