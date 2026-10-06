import pg from 'pg';
import { loadConfig } from './config.mjs';
import { createRepository } from './repository.mjs';
import { createApi } from './http.mjs';
const config = loadConfig();
const pool = new pg.Pool({ ...config.database, max: 5, connectionTimeoutMillis: 3000, idleTimeoutMillis: 30000, statement_timeout: 5000 });
pool.on('error', error => console.error(`Database connection interrupted (${error.code || 'connection_error'})`));
const server = createApi({ repository: createRepository(pool), allowedOrigins: config.allowedOrigins });
server.listen(config.apiPort, '127.0.0.1', () => console.log(`History API listening on localhost:${config.apiPort}`));
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  server.close(async () => { await pool.end(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
