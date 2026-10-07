import pg from 'pg';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { adminDatabase, localDir, privateDir, privateFile } from './runtime.mjs';

const quoteIdentifier = value => `"${String(value).replace(/"/g, '""')}"`;
const quoteLiteral = value => `'${String(value).replace(/'/g, "''")}'`;
const digest = token => createHash('sha256').update(token, 'utf8').digest('hex');
const role = 'history_editor';

// No credentials are generated, read, or installed merely by importing this module.
export async function setupTranslationEditor() {
  process.umask(0o077);
  const config = loadConfig();
  const configFile = join(localDir, 'editor-config.json');
  const keyFile = join(localDir, 'editor-key.txt');
  if (!Array.isArray(config.allowedOrigins) || config.allowedOrigins.some(value => typeof value !== 'string')) {
    throw new Error('The website origin configuration is invalid.');
  }
  privateDir(localDir);
  const client = new pg.Client(adminDatabase(config));
  let inTransaction = false;
  try {
    await client.connect();
    await client.query('BEGIN'); inTransaction = true;
    await client.query("SELECT pg_advisory_xact_lock(hashtext('ancient-history:setup-editor'))");
    let editorConfig, token;
    const hadConfig = existsSync(configFile);
    if (hadConfig) {
      editorConfig = JSON.parse(readFileSync(configFile, 'utf8'));
      if (!/^[a-f0-9]{64}$/i.test(editorConfig.tokenSha256 ?? '')
        || editorConfig.database?.user !== role
        || typeof editorConfig.database.password !== 'string'
        || !/^[a-f0-9]{64}$/i.test(editorConfig.database.password)) {
        throw new Error('Existing editor configuration is invalid; credentials were not rotated.');
      }
      if (!existsSync(keyFile)) throw new Error('The existing editor key file is missing; credentials were not rotated.');
      token = readFileSync(keyFile, 'utf8').trim();
      if (!/^[A-Za-z0-9_-]{32,256}$/.test(token) || digest(token) !== editorConfig.tokenSha256.toLowerCase()) {
        throw new Error('The local editor key does not match its digest; credentials were not rotated.');
      }
      // Keep both secrets while refreshing only ordinary host/origin configuration.
      editorConfig = { tokenSha256: editorConfig.tokenSha256,
        database: { ...config.database, user: role, password: editorConfig.database.password },
        allowedOrigins: [...config.allowedOrigins] };
    } else {
      // Recover a key written before an interrupted first setup without rotating it.
      token = existsSync(keyFile) ? readFileSync(keyFile, 'utf8').trim() : randomBytes(48).toString('base64url');
      if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new Error('The local editor key is invalid.');
      editorConfig = { tokenSha256: digest(token),
        database: { ...config.database, user: role, password: randomBytes(32).toString('hex') },
        allowedOrigins: [...config.allowedOrigins] };
    }
    const existing = await client.query('SELECT oid FROM pg_roles WHERE rolname=$1', [role]);
    if (existing.rowCount && !hadConfig) {
      throw new Error('The dedicated editor role already exists without local credentials. No password was changed.');
    }
    if (!existing.rowCount) {
      await client.query(`CREATE ROLE ${quoteIdentifier(role)} LOGIN PASSWORD ${quoteLiteral(editorConfig.database.password)}
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
    } else {
      const membership = await client.query('SELECT 1 FROM pg_auth_members WHERE member=$1 LIMIT 1', [existing.rows[0].oid]);
      if (membership.rowCount) throw new Error('The dedicated editor role has unexpected role memberships. No grants were changed.');
      await client.query(`ALTER ROLE ${quoteIdentifier(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
    }
    await client.query(readFileSync(new URL('../db/003-translation-editor.sql', import.meta.url), 'utf8'));
    await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${quoteIdentifier(role)};
      REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${quoteIdentifier(role)};
      REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM ${quoteIdentifier(role)};
      REVOKE ALL ON SCHEMA public FROM ${quoteIdentifier(role)};
      GRANT CONNECT ON DATABASE ${quoteIdentifier(config.database.database)} TO ${quoteIdentifier(role)};
      GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(role)};
      GRANT EXECUTE ON FUNCTION public.revise_published_translation(text,integer,bigint,text,text,jsonb) TO ${quoteIdentifier(role)};
      ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM ${quoteIdentifier(role)};
      ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM ${quoteIdentifier(role)};
      ALTER ROLE ${quoteIdentifier(role)} SET default_transaction_read_only = off;
      ALTER ROLE ${quoteIdentifier(role)} SET statement_timeout = '5s';
      ALTER ROLE ${quoteIdentifier(role)} SET lock_timeout = '3s';
      ALTER ROLE ${quoteIdentifier(role)} SET idle_in_transaction_session_timeout = '10s';`);
    // Files precede COMMIT so an interrupted commit can be retried with the same
    // passwords. They contain only local secrets and are never included in logs.
    if (!existsSync(keyFile)) privateFile(keyFile, `${token}\n`);
    else chmodSync(keyFile, 0o600);
    privateFile(configFile, `${JSON.stringify(editorConfig, null, 2)}\n`);
    await client.query('COMMIT'); inTransaction = false;
    return { role, configFile, keyFile };
  } catch (error) {
    if (inTransaction) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { await client.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await setupTranslationEditor();
    console.log('Editor database permissions are ready. The private key is in backend/.local/editor-key.txt.');
  } catch {
    // Do not print arbitrary database errors: they can contain statements/secrets.
    console.error('Editor setup did not finish. Existing credentials were not rotated; inspect the local configuration and retry.');
    process.exitCode = 1;
  }
}
