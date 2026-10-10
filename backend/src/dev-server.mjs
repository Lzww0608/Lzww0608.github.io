import pg from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { createRepository } from './repository.mjs';
import { createTranslationEditor } from './translation-editor.mjs';
import { createApi } from './http.mjs';
import { localDevelopmentOrigins } from './local-development.mjs';

const developmentPort = 8791;
export function validateLocalDevelopmentConfiguration(config, editorConfig) {
  if (!Number.isInteger(config?.apiPort) || config.apiPort < 1 || config.apiPort > 65535
    || config.apiPort === developmentPort) throw new Error('Development API must use a separate port from the production API.');
  if (config?.database?.user !== 'history_reader' || editorConfig?.database?.user !== 'history_editor') {
    throw new Error('Local development requires the restricted reader and editor database accounts.');
  }
  return developmentPort;
}

export async function startLocalDevelopmentServer() {
  const config = loadConfig();
  const editorConfig = JSON.parse(readFileSync(new URL('../.local/editor-config.json', import.meta.url), 'utf8'));
  const port = validateLocalDevelopmentConfiguration(config, editorConfig);
  const poolOptions = { connectionTimeoutMillis: 3000, idleTimeoutMillis: 30000, statement_timeout: 5000 };
  const readerPool = new pg.Pool({ ...config.database, ...poolOptions, max: 5 });
  const editorPool = new pg.Pool({ ...editorConfig.database, ...poolOptions, max: 2 });
  const reportInterrupted = () => console.error('Local development database connection interrupted.');
  readerPool.on('error', reportInterrupted); editorPool.on('error', reportInterrupted);
  let server;
  try {
    const editor = createTranslationEditor({ pool: editorPool, tokenSha256: editorConfig.tokenSha256 });
    server = createApi({ repository: createRepository(readerPool), editor,
      allowedOrigins: localDevelopmentOrigins, localDevelopment: { port } });
    await new Promise((resolveReady, reject) => {
      server.once('error', reject); server.listen(port, '127.0.0.1', resolveReady);
    });
  } catch (error) {
    await Promise.allSettled([readerPool.end(), editorPool.end()]);
    throw error;
  }
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    server.close(async () => {
      await Promise.allSettled([readerPool.end(), editorPool.end()]); process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
  console.log(`Local development API listening on http://127.0.0.1:${port}; local editor password bypass enabled.`);
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startLocalDevelopmentServer().catch(() => {
    // Never print parsed configuration, credential files or database error text.
    console.error('Local development API could not start; check the local restricted editor setup and port 8791.');
    process.exitCode = 1;
  });
}
