import { createServer } from 'node:http';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createEditorHandler } from './editor-http.mjs';
import { parsePersonPassagePagination } from './person-passages.mjs';
import { resolveLocalDevelopment, localDevelopmentRequestFailure } from './local-development.mjs';
const compressJson = promisify(gzip);
const compressionThreshold = 1024;

function responseEncoding(header) {
  if (typeof header !== 'string' || !header.trim()) return { gzip: false, identity: true };
  const weights = new Map();
  for (const member of header.split(',')) {
    const [rawCoding, ...parameters] = member.trim().split(';');
    const coding = rawCoding?.trim().toLowerCase();
    if (!coding || !/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(coding)) continue;
    let weight = 1;
    if (parameters.length) {
      const match = parameters.length === 1 && /^\s*q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)\s*$/i.exec(parameters[0]);
      weight = match ? Number(match[1]) : 0;
    }
    // A repeated explicit prohibition cannot be undone by another list member.
    weights.set(coding, Math.min(weights.get(coding) ?? 1, weight));
  }
  const gzipWeight = weights.get('gzip') ?? weights.get('*') ?? 0;
  const identityWeight = weights.get('identity') ?? (weights.get('*') === 0 ? 0 : 1);
  return { identity: identityWeight > 0, gzip: gzipWeight > 0
    && (!weights.has('identity') || gzipWeight >= identityWeight) };
}

export function createApi({ repository, allowedOrigins, editor = null, log = console.error, localDevelopment = null }) {
  const origins = new Set(allowedOrigins);
  const development = resolveLocalDevelopment(localDevelopment);
  const handleEditor = createEditorHandler({editor, allowedOrigins, log, localDevelopment: development});
  return createServer({ requestTimeout: 10_000, headersTimeout: 10_000, maxHeaderSize: 8192 }, async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Origin');
    const send = (status, data) => { res.setHeader('Cache-Control', 'no-store'); res.removeHeader('ETag'); res.statusCode = status; res.end(req.method === 'HEAD' ? undefined : JSON.stringify(data)); };
    const sendPublic = async (data, revalidate = false) => {
      res.setHeader('Vary', 'Origin, Accept-Encoding');
      const body = JSON.stringify(data);
      // A validator is calculated only after a fresh repository snapshot. Weak
      // tags identify the same JSON across identity/gzip representations.
      if (revalidate) {
        const digest = createHash('sha256').update(body).digest('hex');
        const etag = `W/"${digest}"`;
        res.setHeader('ETag', etag);
        res.setHeader('Cache-Control', 'private, no-cache, must-revalidate');
        const candidates = req.headers['if-none-match'];
        if (typeof candidates === 'string' && candidates.split(',').some(value => {
          const tag = value.trim(); return tag === '*' || tag.replace(/^W\//, '') === `"${digest}"`;
        })) { res.statusCode = 304; return res.end(); }
      }
      // HEAD stays bodyless, and this function is never used by the independent
      // editor handler or by errors/preflights. No credentials enter compression.
      if (req.method !== 'GET') { res.statusCode = 200; return res.end(); }
      const encoding = responseEncoding(req.headers['accept-encoding']);
      if (!encoding.gzip && !encoding.identity) return send(406, { error: 'encoding_not_acceptable' });
      const bytes = Buffer.byteLength(body);
      if (encoding.gzip && (bytes >= compressionThreshold || !encoding.identity)) {
        const compressed = await compressJson(body, { level: 1 });
        if (res.destroyed || res.writableEnded) return;
        if (compressed.length < bytes || !encoding.identity) {
          res.setHeader('Content-Encoding', 'gzip');
          res.statusCode = 200;
          return res.end(compressed);
        }
      }
      res.statusCode = 200;
      res.end(body);
    };
    const localFailure = localDevelopmentRequestFailure(req, development, origins);
    if (localFailure) return send(403, { error: localFailure });
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
      if (path === '/api/health') return await sendPublic(await repository.health());
      if (path === '/api/books') return await sendPublic({ books: await repository.books() });
      const sentences = path.match(/^\/api\/chapters\/([a-z0-9-]+)\/sentence-translations$/);
      if (sentences) {
        const result = await repository.sentenceTranslations(sentences[1]);
        return result ? await sendPublic(result) : send(404, { error: 'not_found' });
      }
      const personPassages = path.match(/^\/api\/people\/([a-z0-9-]+)\/passages$/);
      if (personPassages) {
        const options = parsePersonPassagePagination(url.searchParams);
        const result = await repository.personPassages(personPassages[1], options);
        return result ? await sendPublic(result) : send(404, { error: 'not_found' });
      }
      const personTimeline = path.match(/^\/api\/people\/([a-z0-9-]+)\/timeline$/);
      if (personTimeline) {
        const eventIds = url.searchParams.getAll('eventId');
        if ([...url.searchParams.keys()].some(key => key !== 'eventId') || eventIds.length > 200
          || new Set(eventIds).size !== eventIds.length || eventIds.some(id => !/^[a-z0-9-]{1,120}$/.test(id))) return send(400, { error: 'invalid_request' });
        const result = await repository.personTimeline(personTimeline[1], eventIds.length ? { eventIds } : undefined);
        return result ? await sendPublic(result, true) : send(404, { error: 'not_found' });
      }
      const passage = path.match(/^\/api\/passages\/([a-z0-9-]+)$/);
      if (passage) {
        const result = await repository.passage(passage[1]);
        return result ? await sendPublic(result) : send(404, { error: 'not_found' });
      }
      const chapters = path.match(/^\/api\/books\/([a-z0-9-]+)\/chapters$/);
      if (chapters) {
        const result = await repository.chapters(chapters[1]);
        return result ? await sendPublic({ chapters: result }) : send(404, { error: 'not_found' });
      }
      const chapter = path.match(/^\/api\/chapters\/([a-z0-9-]+)$/);
      if (chapter) {
        const result = await repository.chapter(chapter[1]);
        return result ? await sendPublic(result, true) : send(404, { error: 'not_found' });
      }
      if (path === '/api/search') {
        const q = (url.searchParams.get('q') || '').trim();
        if (!q || q.length > 100) return send(400, { error: 'query_must_be_1_to_100_characters' });
        return await sendPublic({ results: await repository.search(q) });
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
