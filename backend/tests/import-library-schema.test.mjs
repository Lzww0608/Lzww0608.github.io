import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import pg from 'pg';
import { defaultConfigPath } from '../src/config.mjs';
import { importLibrary } from '../scripts/import-library.mjs';
import { loadLibrary } from '../../content/library.mjs';

// Regression: an unqualified import target fails when public is not searchable.
test('library import uses public with a restricted search path and preserves repeated rows', { timeout: 30_000 }, async t => {
  const { socketDir, database: { port } } = JSON.parse(readFileSync(process.env.HISTORY_CONFIG_FILE || defaultConfigPath, 'utf8'));
  assert.ok(typeof socketDir === 'string' && socketDir.startsWith('/'), 'test requires a local Unix socket');
  assert.ok(Number.isSafeInteger(port) && port > 0 && port < 65536, 'test requires a valid local port');
  const user = userInfo().username;
  const database = `history_import_library_schema_test_${process.pid}_${randomBytes(5).toString('hex')}`;
  assert.match(database, /^history_import_library_schema_test_\d+_[a-f0-9]{10}$/);
  const connection = { host: socketDir, port, user, password: randomBytes(32).toString('hex'), connectionTimeoutMillis: 5_000 };
  const loaded = loadLibrary();
  const chapter = { ...loaded.chapters[0], paragraphs: loaded.chapters[0].paragraphs.slice(0, 1) };
  const book = loaded.catalog.books.find(entry => entry.id === chapter.bookId);
  assert.ok(book && chapter.paragraphs.length === 1, 'real library has a complete fixture');
  const library = {
    catalog: { ...loaded.catalog, books: [book], chapters: loaded.catalog.chapters.filter(entry => entry.id === chapter.id) },
    chapters: [chapter],
  };
  const tables = ['books', 'editions', 'chapters', 'paragraphs', 'paragraph_revisions'];
  const admin = new pg.Client({ ...connection, database: 'postgres' });
  let owner, created = false, transactionOpen = false, ownerClosed = false, dropped = false;
  try {
    await admin.connect();
    assert.deepEqual((await admin.query('SELECT current_database() AS database, current_user AS owner')).rows, [{ database: 'postgres', owner: user }]);
    assert.equal((await admin.query('SELECT 1 FROM pg_catalog.pg_database WHERE datname=$1', [database])).rowCount, 0, 'random test database must not preexist');
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    assert.deepEqual((await admin.query('SELECT pg_catalog.pg_get_userbyid(datdba) AS owner FROM pg_catalog.pg_database WHERE datname=$1', [database])).rows, [{ owner: user }]);
    t.diagnostic(JSON.stringify({ stage: 'created-own-database', database, owner: user, pid: process.pid }));
    owner = new pg.Client({ ...connection, database });
    await owner.connect();
    assert.equal((await owner.query('SELECT current_database() AS database')).rows[0].database, database);
    await owner.query('SET search_path=public');
    await owner.query(readFileSync(new URL('../db/001-initial.sql', import.meta.url), 'utf8'));
    await owner.query('SET search_path=pg_catalog');

    await owner.query('BEGIN'); transactionOpen = true;
    assert.deepEqual(await importLibrary(owner, library), { books: 1, chapters: 1, paragraphs: 1 });
    await owner.query('COMMIT'); transactionOpen = false;
    assert.deepEqual((await owner.query('SHOW search_path')).rows, [{ search_path: 'pg_catalog' }]);
    assert.deepEqual((await owner.query(`SELECT n.nspname AS schema, c.relname AS name
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind='r' AND c.relname=ANY($1::text[]) ORDER BY c.relname`, [tables])).rows,
    [
      { schema: 'public', name: 'books' },
      { schema: 'public', name: 'chapters' },
      { schema: 'public', name: 'editions' },
      { schema: 'public', name: 'paragraph_revisions' },
      { schema: 'public', name: 'paragraphs' },
    ]);
    const snapshot = async () => {
      const rows = {};
      for (const table of tables) {
        const order = table === 'paragraph_revisions' ? 'paragraph_id,revision' : 'id';
        rows[table] = (await owner.query(`SELECT to_jsonb(t) AS row FROM public.${table} t ORDER BY ${order}`)).rows.map(entry => entry.row);
      }
      return rows;
    };
    const first = await snapshot();
    for (const table of tables) assert.equal(first[table].length, 1, `${table} has its imported public row`);
    assert.equal(first.books[0].id, book.id);
    assert.equal(first.books[0].title, book.title);
    assert.equal(first.books[0].published, true);
    assert.equal(first.editions[0].id, chapter.editionId);
    assert.equal(first.editions[0].book_id, book.id);
    assert.equal(first.chapters[0].id, chapter.id);
    assert.equal(first.chapters[0].scope, 'full');
    assert.equal(first.chapters[0].published, true);
    assert.equal(first.paragraphs[0].id, chapter.paragraphs[0].id);
    assert.equal(first.paragraphs[0].current_revision, 1);
    assert.equal(first.paragraph_revisions[0].original, chapter.paragraphs[0].original);
    await owner.query('BEGIN'); transactionOpen = true;
    assert.deepEqual(await importLibrary(owner, library), { books: 1, chapters: 1, paragraphs: 1 });
    await owner.query('COMMIT'); transactionOpen = false;
    assert.deepEqual(await snapshot(), first, 'repeat import must preserve every stored field');
    assert.deepEqual((await owner.query('SHOW search_path')).rows, [{ search_path: 'pg_catalog' }]);
  } finally {
    try {
      if (owner) {
        if (transactionOpen) await owner.query('ROLLBACK');
        await owner.end(); ownerClosed = true;
      }
      if (created) {
        assert.ok(ownerClosed || !owner, 'owner connection must close before drop');
        assert.match(database, /^history_import_library_schema_test_\d+_[a-f0-9]{10}$/);
        assert.deepEqual((await admin.query('SELECT pg_catalog.pg_get_userbyid(datdba) AS owner FROM pg_catalog.pg_database WHERE datname=$1', [database])).rows, [{ owner: user }]);
        await admin.query(`DROP DATABASE "${database}"`);
        dropped = true;
        assert.equal((await admin.query('SELECT 1 FROM pg_catalog.pg_database WHERE datname=$1', [database])).rowCount, 0);
      }
    } finally {
      await admin.end();
      t.diagnostic(JSON.stringify({ stage: 'closed-own-resources', database, owner: user, created, ownerClosed, dropped, nonForceDrop: true, adminClosed: true }));
    }
  }
});
