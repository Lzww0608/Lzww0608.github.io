import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { userInfo } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import pg from 'pg';
import { seed } from './seed.mjs';
import { backendDir, localDir, pgBin, labels, run, privateDir, privateFile, installAgent, waitUntil, adminDatabase } from './runtime.mjs';
if (process.platform !== 'darwin') throw new Error('This setup script supports macOS only.');
process.umask(0o077);
for (const folder of [localDir, join(localDir, 'logs'), join(localDir, 'run'), join(localDir, 'backups'), join(localDir, 'tailscale')]) privateDir(folder);
const configFile = join(localDir, 'config.json');
const nodeBinary = existsSync('/opt/homebrew/opt/node/bin/node') ? '/opt/homebrew/opt/node/bin/node' : process.execPath;
const config = existsSync(configFile) ? JSON.parse(readFileSync(configFile, 'utf8')) : {
  apiPort: 8787,
  socketDir: join(localDir, 'run'),
  dataDir: join(localDir, 'postgres'),
  database: { host: '127.0.0.1', port: 55432, database: 'ancient_history', user: 'history_reader', password: randomBytes(32).toString('hex') },
  allowedOrigins: ['https://lzww0608.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173'],
};
for (const port of [config.apiPort, config.database.port]) {
  // Only a first installation checks unoccupied ports; subsequent runs own these services.
  if (!existsSync(configFile)) await new Promise((resolve, reject) => {
    const probe = createServer(); probe.once('error', reject); probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}
privateFile(configFile, `${JSON.stringify(config, null, 2)}\n`);
if (!existsSync(join(config.dataDir, 'PG_VERSION'))) {
  const shares = ['/opt/homebrew/opt/postgresql@17/share/postgresql@17', '/opt/homebrew/opt/postgresql@17/share/postgresql'];
  const share = shares.find(folder => existsSync(join(folder, 'postgres.bki')));
  if (!share) throw new Error('PostgreSQL installation is incomplete: postgres.bki is missing.');
  run(join(pgBin, 'initdb'), ['-D', config.dataDir, '-L', share, '-U', userInfo().username, '--auth-local=peer', '--auth-host=scram-sha-256', '--locale=C', '-E', 'UTF8']);
  appendFileSync(join(config.dataDir, 'postgresql.conf'), `\n# Dedicated history database; never listen on the LAN.\nlisten_addresses = '127.0.0.1'\nport = ${config.database.port}\nunix_socket_directories = '${config.socketDir.replace(/'/g, "''")}'\npassword_encryption = 'scram-sha-256'\nmax_connections = 30\nshared_buffers = '128MB'\nlogging_collector = off\nlog_statement = 'none'\n`);
}
await installAgent(labels.postgres, [join(pgBin, 'postgres'), '-D', config.dataDir]);
await waitUntil(() => run(join(pgBin, 'pg_isready'), ['-h', config.socketDir, '-p', String(config.database.port)]).includes('accepting connections'));
const bootstrap = new pg.Client({ ...adminDatabase(config), database: 'postgres' });
await bootstrap.connect();
try {
  const role = await bootstrap.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [config.database.user]);
  if (!role.rowCount) await bootstrap.query(`CREATE ROLE history_reader LOGIN PASSWORD '${config.database.password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`);
  const db = await bootstrap.query('SELECT 1 FROM pg_database WHERE datname=$1', [config.database.database]);
  if (!db.rowCount) await bootstrap.query('CREATE DATABASE ancient_history');
} finally { await bootstrap.end(); }
const client = new pg.Client(adminDatabase(config));
await client.connect();
try {
  await client.query('BEGIN'); await seed(client);
  await client.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    GRANT CONNECT ON DATABASE ancient_history TO history_reader;
    GRANT USAGE ON SCHEMA public TO history_reader;
    GRANT SELECT ON public.books,public.editions,public.chapters,public.paragraphs,public.paragraph_revisions,
      public.translations,public.person_passage_index,public.passage_people,public.passages,
      public.passage_spans,public.person_passages,public.sentence_translations TO history_reader;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM history_reader;
    ALTER ROLE history_reader SET default_transaction_read_only = on;
    ALTER ROLE history_reader SET statement_timeout = '5s'`);
  await client.query('COMMIT');
} catch (error) { await client.query('ROLLBACK'); throw error; }
finally { await client.end(); }
await installAgent(labels.api, [nodeBinary, join(backendDir, 'src/server.mjs')]);
await waitUntil(async () => (await fetch(`http://127.0.0.1:${config.apiPort}/api/health`)).ok);
await installAgent(labels.backup, [nodeBinary, join(backendDir, 'scripts/backup.mjs')], { calendar: { hour: 3, minute: 15 } });
if (process.argv.includes('--with-tailscale')) {
  if (!existsSync('/opt/homebrew/bin/tailscaled')) throw new Error('Install the Tailscale CLI before configuring its agent.');
  await installAgent(labels.tunnel, ['/opt/homebrew/bin/tailscaled', '--tun=userspace-networking', `--state=${join(localDir, 'tailscale/state.json')}`, `--socket=${join(localDir, 'run/tailscaled.sock')}`]);
  await waitUntil(() => existsSync(join(localDir, 'run/tailscaled.sock')));
}
console.log('Database and API are running. Login auto-start, crash restart and daily local backups are configured.');
console.log('API: http://127.0.0.1:8787/api/health');
console.log('Tailscale login and HTTPS publishing are managed separately with scripts/tunnel.mjs.');
