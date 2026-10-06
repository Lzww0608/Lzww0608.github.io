import pg from 'pg';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../src/config.mjs';
import { adminDatabase, localDir, pgBin, run } from './runtime.mjs';
const config = loadConfig();
const folder = join(localDir, 'backups');
const latest = readdirSync(folder).filter(name => name.endsWith('.dump')).sort().at(-1);
const file = process.argv[2] ? resolve(process.argv[2]) : latest ? join(folder, latest) : null;
if (!file) throw new Error('No backup found. Run npm run backup first.');
const database = `history_restore_check_${process.pid}_${randomBytes(4).toString('hex')}`;
const admin = new pg.Client({ ...adminDatabase(config), database: 'postgres' });
let created = false, check;
try {
  await admin.connect(); await admin.query(`CREATE DATABASE ${database}`); created = true;
  run(join(pgBin, 'pg_restore'), ['--exit-on-error', '--no-owner', '-h', config.socketDir, '-p', String(config.database.port), '-d', database, file]);
  check = new pg.Client({ ...adminDatabase(config), database }); await check.connect();
  const counts = await check.query('SELECT (SELECT count(*)::int FROM books) AS books, (SELECT count(*)::int FROM chapters) AS chapters, (SELECT count(*)::int FROM paragraphs) AS paragraphs, (SELECT count(*)::int FROM translations) AS translations');
  console.log('Backup restored successfully in an isolated temporary database:', counts.rows[0]);
} finally {
  if (check) await check.end();
  if (created) await admin.query(`DROP DATABASE ${database}`);
  await admin.end();
}
