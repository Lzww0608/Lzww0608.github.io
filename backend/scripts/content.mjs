import pg from 'pg';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.mjs';
import { adminDatabase } from './runtime.mjs';
const [command, id, file, ...options] = process.argv.slice(2);
const client = new pg.Client(adminDatabase(loadConfig()));
await client.connect();
try {
  await client.query('BEGIN');
  if (command === 'original' || command === 'translation') {
    const text = readFileSync(file, 'utf8').trim();
    if (!text || text.length > 20000) throw new Error('Text must contain 1–20000 characters.');
    const result = await client.query('SELECT * FROM paragraphs WHERE id=$1 FOR UPDATE', [id]);
    if (!result.rowCount) throw new Error('Paragraph not found.');
    const paragraph = result.rows[0];
    if (command === 'original') {
      const revision = paragraph.current_revision + 1;
      await client.query('INSERT INTO paragraph_revisions (paragraph_id,revision,original) VALUES ($1,$2,$3)', [id, revision, text]);
      await client.query('UPDATE paragraphs SET current_revision=$2 WHERE id=$1', [id, revision]);
      console.log(`Original saved as revision ${revision}; previous originals and translations are preserved.`);
    } else {
      const translator = options[options.indexOf('--translator') + 1];
      if (!options.includes('--translator') || !translator) throw new Error('Provide --translator followed by the translator name.');
      const translation = await client.query(`INSERT INTO translations (paragraph_id,original_revision,version,text,translator,status)
        SELECT $1,$2,coalesce(max(version),0)+1,$3,$4,'draft' FROM translations WHERE paragraph_id=$1 AND original_revision=$2 AND language='zh-Hans' RETURNING id,version`, [id, paragraph.current_revision, text, translator]);
      console.log(`Translation ${translation.rows[0].id} saved as a private draft, version ${translation.rows[0].version}. Review it before publishing.`);
    }
  } else if (command === 'review' || command === 'publish') {
    if (!/^\d+$/.test(id || '')) throw new Error('Provide a translation ID.');
    const result = await client.query('SELECT t.*,p.current_revision FROM translations t JOIN paragraphs p ON p.id=t.paragraph_id WHERE t.id=$1 FOR UPDATE OF t,p', [id]);
    if (!result.rowCount) throw new Error('Translation not found.');
    const item = result.rows[0];
    if (item.current_revision !== item.original_revision) throw new Error('Original was revised; create a translation for the current original before publishing.');
    if (command === 'publish' && item.status !== 'reviewed') throw new Error('Review the translation before publishing.');
    if (command === 'review' && item.status !== 'draft') throw new Error('Only a draft can be reviewed.');
    await client.query('UPDATE translations SET status=$2 WHERE id=$1', [id, command === 'review' ? 'reviewed' : 'published']);
    console.log(`Translation ${id}: ${command === 'review' ? 'reviewed' : 'published'}.`);
  } else if (command === 'list') {
    const { rows } = await client.query('SELECT id,paragraph_id,original_revision,version,status,translator,text FROM translations ORDER BY id');
    console.table(rows);
  } else throw new Error('Use original <paragraph-id> <text-file>, translation <paragraph-id> <text-file> --translator <name>, review <translation-id>, publish <translation-id>, or list.');
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK'); console.error(error.message); process.exitCode = 1;
} finally { await client.end(); }
