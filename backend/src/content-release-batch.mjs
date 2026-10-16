// Local administration only. No server route imports this module.
import { digest } from './backup-archive.mjs';
import { validateTranslationBatch, textHash } from './translation-batch.mjs';
import { loadPassagePeople, validatePersonPassageIndex } from '../../content/person-passages.mjs';
import { validatePersonTimeline } from '../../content/person-timelines.mjs';
import { splitReadingSpans, isClickableReadingSpan, matchesPeriodSentenceRanges, matchesTailSentenceRanges } from '../../frontend/src/sentence-alignment.ts';
import { importLibrary } from '../scripts/import-library.mjs';
import { importTranslationBatch } from '../scripts/import-translations.mjs';
import { publishAiBatch } from '../scripts/publish-ai-batch.mjs';
import { importSentenceTranslationBatch } from '../scripts/import-sentence-translations.mjs';
import { importPersonPassages } from '../scripts/import-person-passages.mjs';
import { importPersonTimelines } from '../scripts/import-person-timelines.mjs';
import { importReviewItems } from '../scripts/import-review-items.mjs';
import { applyReviewCorrections, validateReviewCorrectionBatch } from '../scripts/apply-review-corrections.mjs';

const check = (ok, message) => { if (!ok) throw new Error(`Content release: ${message}`); };
const checksum = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,99}$/.test(value);
export const releaseFaultStages = Object.freeze(['sources', 'drafts', 'publication', 'corrections', 'sentences', 'passages', 'timelines', 'reviews']);

export function freezeContentRelease(content) {
  const frozen = { schemaVersion: 1, content: structuredClone(content), fingerprint: digest(content) };
  validateContentRelease(frozen);
  return frozen;
}

export function validateContentRelease(frozen) {
  check(frozen?.schemaVersion === 1 && checksum(frozen.fingerprint) && digest(frozen.content) === frozen.fingerprint, 'frozen fingerprint differs');
  const c = frozen.content;
  check(c.schemaVersion === 1 && id(c.id) && c.humanReviewed === false, 'identity/provenance');
  check(digest(c.people) === digest(loadPassagePeople()), 'canonical registry differs; wire the approved public catalog first');
  for (const name of ['translationBatches', 'sentenceBatches', 'alignments', 'timelines', 'reviewBatches']) check(Array.isArray(c[name]), name);
  const library = c.library;
  check(Array.isArray(library?.catalog?.books) && Array.isArray(library.chapters), 'library');
  const bookIds = new Set(), chapterIds = new Set(), sources = new Map(), positions = new Set();
  for (const book of library.catalog.books) {
    check(id(book.id) && !bookIds.has(book.id), 'duplicate book'); bookIds.add(book.id);
    check(['title', 'author', 'description', 'url', 'defaultChapter'].every(k => typeof book[k] === 'string' && book[k].trim()), 'book metadata');
  }
  for (const chapter of library.chapters) {
    check(/^[a-z]+-v\d+$/.test(chapter.id) && !chapterIds.has(chapter.id) && bookIds.has(chapter.bookId)
      && chapter.editionId === `${chapter.bookId}-local-wikisource` && chapter.scope === 'full', 'chapter identity');
    const position = `${chapter.bookId}/${chapter.position}`;
    check(Number.isSafeInteger(chapter.position) && chapter.position > 0 && !positions.has(position), 'chapter position');
    positions.add(position); chapterIds.add(chapter.id);
    check(Array.isArray(chapter.paragraphs) && chapter.paragraphs.length && Array.isArray(chapter.notes), 'complete chapter');
    for (const [i, p] of chapter.paragraphs.entries()) {
      check(p.id === `${chapter.id}-p${i + 1}` && p.position === i + 1 && p.revision === 1 && typeof p.original === 'string' && p.original.trim()
        && !sources.has(p.id), 'original identity'); sources.set(p.id, { chapter, paragraph: p });
    }
  }
  for (const b of library.catalog.books) check(library.chapters.some(c => c.id === b.defaultChapter && c.bookId === b.id), 'default chapter');
  const bookUpdates = c.bookMetadataUpdates ?? [];
  check(Array.isArray(bookUpdates), 'book metadata updates');
  const updatedBooks = new Set();
  for (const update of bookUpdates) {
    const book = library.catalog.books.find(b => b.id === update?.id);
    check(book && !updatedBooks.has(update.id) && Object.keys(update).every(k => ['id', 'expectedDescription', 'description'].includes(k))
      && typeof update.expectedDescription === 'string' && update.expectedDescription.trim() && typeof update.description === 'string'
      && update.description.trim() && update.description === book.description, 'book description update');
    updatedBooks.add(update.id);
    const exceptions = (c.allowedOldRowChanges ?? []).filter(e => e.table === 'books' && e.key === JSON.stringify([update.id]));
    check(exceptions.length === 1 && checksum(exceptions[0].beforeSha256) && checksum(exceptions[0].afterSha256), 'book description requires one exact row exception');
  }
  for (const e of c.allowedOldRowChanges ?? []) if (e.table === 'books') check(bookUpdates.some(u => e.key === JSON.stringify([u.id])), 'unapproved book row exception');
  const translated = new Map(), batches = new Set();
  for (const batch of c.translationBatches) {
    validateTranslationBatch(batch, library); check(!batches.has(batch.id), 'duplicate translation batch'); batches.add(batch.id);
    for (const entry of batch.entries) { check(!translated.has(entry.paragraphId), 'duplicate full translation'); translated.set(entry.paragraphId, entry); }
  }
  if (c.correctionBatch) {
    for (const entry of validateReviewCorrectionBatch(c.correctionBatch).entries) {
      const p = sources.get(entry.paragraphId)?.paragraph;
      check(p && p.revision === entry.expectedOriginalRevision && textHash(p.original) === entry.originalSha256 && !translated.has(entry.paragraphId), 'correction source/duplicate');
      translated.set(entry.paragraphId, entry);
    }
  }
  validatePersonPassageIndex(c.passageIndex, library);
  const timelines = new Set();
  for (const doc of c.timelines) { validatePersonTimeline(doc, library); check(!timelines.has(doc.personId), 'duplicate timeline'); timelines.add(doc.personId); }
  const alignments = new Map();
  for (const a of c.alignments) {
    const p = sources.get(a.paragraphId)?.paragraph;
    check(p && !alignments.has(a.paragraphId) && a.originalRevision === p.revision && a.originalSha256 === textHash(p.original)
      && checksum(a.translationSha256), 'alignment source'); alignments.set(a.paragraphId, a);
    if (translated.has(a.paragraphId)) validateRanges(a, p.original, translated.get(a.paragraphId).text);
  }
  const supplementSpans = new Set(), supplementIds = new Set(), sentenceBatchIds = new Set();
  for (const batch of c.sentenceBatches) {
    check(id(batch.id) && !sentenceBatchIds.has(batch.id) && batch.schemaVersion === 1 && Array.isArray(batch.entries) && batch.entries.length, 'sentence batch'); sentenceBatchIds.add(batch.id);
    for (const e of batch.entries) {
      const p = sources.get(e.paragraphId)?.paragraph, key = `${e.paragraphId}/${e.originalStart}/${e.originalEnd}`;
      check(p && !supplementSpans.has(key) && !supplementIds.has(e.id) && e.originalRevision === p.revision && e.originalSha256 === textHash(p.original)
        && checksum(e.parentTranslationSha256) && e.origin === 'ai' && e.humanReviewed === false, 'sentence supplement');
      supplementSpans.add(key); supplementIds.add(e.id);
    }
  }
  // Every newly supplied full translation must cover actual click targets, not
  // a sentence-count estimate. Nonpunctuated tails remain nonclickable.
  for (const [paragraphId] of translated) {
    const p = sources.get(paragraphId).paragraph, a = alignments.get(paragraphId);
    for (const unit of splitReadingSpans(p.original).filter(s => isClickableReadingSpan(s.text))) {
      const inRange = [...(a?.sentences ?? []), ...(a?.tailSentences ?? [])].some(r => r.originalStart === unit.start && r.originalEnd === unit.end);
      check(inRange || supplementSpans.has(`${paragraphId}/${unit.start}/${unit.end}`), `sentence coverage ${paragraphId}/${unit.start}`);
    }
  }
  return c;
}

function validateRanges(a, original, text) {
  check(a.translationSha256 === textHash(text), `translation alignment ${a.paragraphId}`);
  if (a.sentences !== undefined) check(matchesPeriodSentenceRanges(a.sentences, original, text), `period ranges ${a.paragraphId}`);
  if (a.tailSentences !== undefined) check(matchesTailSentenceRanges(a.tailSentences, original, text), `tail ranges ${a.paragraphId}`);
  for (const r of [...(a.sentences ?? []), ...(a.tailSentences ?? [])]) check(['originalStart', 'originalEnd', 'translationStart', 'translationEnd'].every(k => Number.isSafeInteger(r[k]) && r[k] >= 0)
    && r.translationEnd <= [...text].length, `range bounds ${a.paragraphId}`);
}

// The frozen template has no guessed identity. Only the approved full text hash
// may select the actual latest published record from this transaction.
export function rebindReleaseParents(content, rows) {
  const result = structuredClone(content), byId = new Map(rows.map(r => [r.id, r]));
  const bind = (e, sha) => {
    const r = byId.get(e.paragraphId);
    check(r && r.current_revision === e.originalRevision && textHash(r.original) === e.originalSha256, `source binding ${e.paragraphId}`);
    check(r.translation_id && r.version > 0 && textHash(r.text) === sha, `translation binding ${e.paragraphId}`);
    return r;
  };
  for (const a of result.alignments) { const r = bind(a, a.translationSha256); validateRanges(a, r.original, r.text); a.translationId = r.translation_id; a.translationVersion = r.version; }
  for (const batch of result.sentenceBatches) for (const e of batch.entries) { const r = bind(e, e.parentTranslationSha256); e.parentTranslationId = r.translation_id; e.parentTranslationVersion = r.version; }
  for (const batch of result.reviewBatches) for (const item of batch.items) {
    if (item.translationSha256 !== null) { const r = bind(item, item.translationSha256); item.translationId = r.translation_id; item.translationVersion = r.version; }
    else check(item.translationId === null && item.translationVersion === null, 'null review binding');
  }
  return result;
}

const quote = name => `"${name.replaceAll('"', '""')}"`;
export async function snapshotReleaseDatabase(client) {
  await client.query("SET TIME ZONE 'UTC'"); await client.query("SET datestyle TO 'ISO,YMD'");
  const names = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  const tables = {}, inventory = {};
  for (const { tablename } of names) {
    const keys = (await client.query(`SELECT a.attname FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum
      WHERE n.nspname='public' AND c.relname=$1 AND i.indisprimary ORDER BY k.ord`, [tablename])).rows.map(r => r.attname);
    check(keys.length, `table lacks stable primary key ${tablename}`);
    const rows = (await client.query(`SELECT jsonb_build_array(${keys.map(k => 't.' + quote(k)).join(',')})::text AS key,
      encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS hash FROM public.${quote(tablename)} t`)).rows;
    inventory[tablename] = Object.fromEntries(rows.map(r => [r.key, r.hash]));
    tables[tablename] = { rows: rows.length, sha256: textHash(rows.map(r => r.hash).sort().join('\n')) };
  }
  const sequences = {};
  for (const { sequencename } of (await client.query("SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows)
    sequences[sequencename] = (await client.query(`SELECT last_value::text,is_called FROM public.${quote(sequencename)}`)).rows[0];
  const schema = {};
  schema.sequences = (await client.query("SELECT sequencename,data_type,start_value,min_value,max_value,increment_by,cycle,cache_size FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows;
  schema.extensions = (await client.query('SELECT extname,extversion FROM pg_extension ORDER BY extname')).rows;
  schema.columns = (await client.query("SELECT table_name,column_name,ordinal_position,column_default,is_nullable,data_type,udt_schema,udt_name,is_identity,identity_generation FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position")).rows;
  schema.constraints = (await client.query("SELECT c.relname AS relation,n.conname,pg_get_constraintdef(n.oid) AS definition FROM pg_constraint n JOIN pg_class c ON c.oid=n.conrelid JOIN pg_namespace s ON s.oid=c.relnamespace WHERE s.nspname='public' ORDER BY c.relname,n.conname")).rows;
  schema.functions = (await client.query("SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p') ORDER BY p.proname,arguments")).rows;
  schema.indexes = (await client.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname")).rows;
  schema.views = (await client.query("SELECT c.relname,pg_get_viewdef(c.oid) AS definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('v','m') ORDER BY c.relname")).rows;
  schema.triggers = (await client.query("SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname")).rows;
  const state = { tables, sequences, schemaSha256: digest(schema) }; return { ...state, sha256: digest(state), inventory };
}

// Existing primary keys are append-only, except exact documents explicitly in
// this frozen batch. Passage deletion/kind edits need individually frozen old
// and new hashes; a global replacement index alone is not authorization.
export function assertReleasePreserved(before, after, content) {
  const exceptions = new Map();
  for (const e of content.allowedOldRowChanges ?? []) {
    const approvedBook = e.table === 'books' && checksum(e.afterSha256) && (content.bookMetadataUpdates ?? []).some(u => e.key === JSON.stringify([u.id]));
    check((['passages', 'passage_spans', 'person_passages'].includes(e.table) || approvedBook) && typeof e.key === 'string' && checksum(e.beforeSha256)
      && (e.afterSha256 === null || checksum(e.afterSha256)), 'old-row exception');
    const identity = `${e.table}/${e.key}`; check(!exceptions.has(identity), 'duplicate old-row exception'); exceptions.set(identity, e);
    const previous = before.inventory[e.table]?.[e.key] ?? null;
    check((previous === e.beforeSha256 || previous === e.afterSha256) && (after.inventory[e.table]?.[e.key] ?? null) === e.afterSha256, 'old-row exception differs');
  }
  const timelineIds = new Set(content.timelines.map(d => d.personId));
  const reviewIds = new Set(content.reviewBatches.flatMap(b => b.items.filter(i => i.expectedVersion !== undefined).map(i => i.id)));
  for (const [table, rows] of Object.entries(before.inventory)) {
    check(after.inventory[table], `old table removed ${table}`);
    for (const [key, hash] of Object.entries(rows)) {
      if (table === 'person_passage_index' || table === 'person_timelines' && timelineIds.has(JSON.parse(key)[0])
        || table === 'owner_review_items' && reviewIds.has(JSON.parse(key)[0]) || exceptions.has(`${table}/${key}`)) continue;
      check(after.inventory[table][key] === hash, `protected old row differs ${table}/${key}`);
    }
  }
  return true;
}

async function applyBookMetadataUpdates(client, content) {
  const result = [];
  for (const update of content.bookMetadataUpdates ?? []) {
    const exception = content.allowedOldRowChanges.find(e => e.table === 'books' && e.key === JSON.stringify([update.id]));
    const row = (await client.query(`SELECT b.description,encode(sha256(convert_to(to_jsonb(b)::text,'UTF8')),'hex') AS hash
      FROM public.books b WHERE b.id=$1 FOR UPDATE`, [update.id])).rows[0];
    check(row && (row.description === update.expectedDescription || row.description === update.description), `book description conflict ${update.id}`);
    if (row.description === update.description) {
      check(row.hash === exception.afterSha256, `book metadata after hash differs ${update.id}`);
      result.push({ id: update.id, updated: false }); continue;
    }
    check(row.hash === exception.beforeSha256, `book metadata before hash differs ${update.id}`);
    // Never upsert title, author, URL, publication status or an arbitrary column.
    const saved = (await client.query(`UPDATE public.books b SET description=$2 WHERE b.id=$1
      RETURNING encode(sha256(convert_to(to_jsonb(b)::text,'UTF8')),'hex') AS hash`, [update.id, update.description])).rows[0];
    check(saved?.hash === exception.afterSha256, `book metadata after hash differs ${update.id}`);
    result.push({ id: update.id, updated: true });
  }
  return result;
}

async function readCurrent(client, ids) {
  return (await client.query(`SELECT p.id,p.chapter_id,p.position,p.current_revision,r.original,b.id AS book_id,
    b.published AND c.published AS visible,t.id::text AS translation_id,t.version,t.text
    FROM public.paragraphs p JOIN public.paragraph_revisions r ON r.paragraph_id=p.id AND r.revision=p.current_revision
    JOIN public.chapters c ON c.id=p.chapter_id JOIN public.editions e ON e.id=c.edition_id JOIN public.books b ON b.id=e.book_id
    LEFT JOIN LATERAL (SELECT tr.* FROM public.translations tr WHERE tr.paragraph_id=p.id AND tr.original_revision=p.current_revision
      AND tr.language='zh-Hans' AND tr.status='published' ORDER BY tr.version DESC LIMIT 1) t ON true
    WHERE p.id=ANY($1::text[]) ORDER BY p.id`, [ids])).rows;
}

// Use one dedicated, idle pg client. This function owns the only outer COMMIT;
// importer savepoints never publish a partial library.
export async function publishContentRelease(client, frozen, { expectedDatabase, allowFormal = false, baselineStateSha256, faultAfter = null, verification } = {}) {
  const c = validateContentRelease(frozen);
  check(typeof expectedDatabase === 'string' && expectedDatabase, 'explicit database identity required');
  check(allowFormal || /^history_content_release_test_[a-z0-9_]+$/.test(expectedDatabase), 'isolated database required');
  if (allowFormal) check(checksum(baselineStateSha256) && verification?.verified === true && verification.fingerprint === frozen.fingerprint
    && verification.baselineDatabaseSha256 === baselineStateSha256 && verification.actualDumpRestoredForEveryAttempt === true
    && verification.formalDatabaseWritten === false && verification.success?.idempotent === true && faultAfter === null, 'formal publication requires actual isolated verification');
  check(faultAfter === null || releaseFaultStages.includes(faultAfter), 'unknown failure stage');
  const fail = stage => { if (faultAfter === stage) throw new Error(`Injected content release failure: ${stage}`); };
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  try {
    const actual = (await client.query('SELECT current_database() AS name')).rows[0].name;
    check(actual === expectedDatabase, 'connected database identity differs');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('ancient-history:content-release'))");
    await client.query('LOCK TABLE public.books,public.chapters,public.paragraphs,public.paragraph_revisions,public.translations IN SHARE ROW EXCLUSIVE MODE');
    const baseline = await snapshotReleaseDatabase(client);
    if (baselineStateSha256) check(baseline.sha256 === baselineStateSha256, 'baseline database changed');
    const registered = new Set((await client.query('SELECT id FROM public.passage_people')).rows.map(p => p.id));
    for (const person of c.people.filter(p => !registered.has(p.id))) {
      check(c.timelines.some(t => t.personId === person.id) && c.passageIndex.passages.some(p => p.people.some(a => a.personId === person.id)), `new person lacks sourced timeline/passages ${person.id}`);
      check(c.reviewBatches.some(b => b.subjects.some(s => s.id === person.id && s.name === person.name)), `new person lacks protected review scope ${person.id}`);
    }
    const sourceMap = new Map(c.library.chapters.flatMap(ch => ch.paragraphs.map(p => [p.id, { chapter: ch, paragraph: p }])));
    const ids = [...sourceMap.keys()];
    const before = await readCurrent(client, ids), existingIds = new Set(before.map(r => r.id));
    for (const r of before) {
      const { chapter, paragraph } = sourceMap.get(r.id);
      check(r.visible && r.chapter_id === chapter.id && r.book_id === chapter.bookId && r.position === paragraph.position
        && r.current_revision === paragraph.revision && r.original === paragraph.original, `existing original differs ${r.id}`);
    }
    const newIds = ids.filter(p => !existingIds.has(p));
    const supplied = new Set(c.translationBatches.flatMap(b => b.entries.map(e => e.paragraphId)));
    for (const p of newIds) check(supplied.has(p), `new original lacks complete translation ${p}`);
    const bookMetadataUpdates = await applyBookMetadataUpdates(client, c);
    const sources = await importLibrary(client, c.library); fail('sources');
    const drafts = []; for (const batch of c.translationBatches) drafts.push(await importTranslationBatch(client, batch, { library: c.library })); fail('drafts');
    const publications = []; for (const batch of c.translationBatches) publications.push(await publishAiBatch(client, batch, { library: c.library })); fail('publication');
    const corrections = c.correctionBatch ? await applyReviewCorrections(client, c.correctionBatch) : null; fail('corrections');
    const rows = await readCurrent(client, ids);
    check(rows.length === ids.length, 'incomplete current library');
    for (const p of newIds) check(rows.find(r => r.id === p)?.translation_id, `new original remains untranslated ${p}`);
    const bound = rebindReleaseParents(c, rows);
    const chapters = structuredClone(c.library.chapters), current = new Map(rows.map(r => [r.id, r]));
    for (const ch of chapters) for (const p of ch.paragraphs) { const r = current.get(p.id); p.translation = r.translation_id ? { id: r.translation_id, version: r.version, text: r.text } : null; }
    const sentences = []; for (const batch of bound.sentenceBatches) sentences.push(await importSentenceTranslationBatch(client, batch, { publish: true, chapters })); fail('sentences');
    const passages = await importPersonPassages(client, c.passageIndex, c.library); fail('passages');
    const timelines = c.timelines.length ? await importPersonTimelines(client, c.timelines, c.library) : { people: 0, events: 0 }; fail('timelines');
    const reviews = []; for (const batch of bound.reviewBatches) reviews.push(await importReviewItems(client, batch)); fail('reviews');
    const after = await snapshotReleaseDatabase(client);
    assertReleasePreserved(baseline, after, c);
    await client.query('COMMIT');
    return { schemaVersion: 1, committed: true, fingerprint: frozen.fingerprint, humanReviewed: false,
      sources, bookMetadataUpdates, newParagraphs: newIds.length, drafts, publications, corrections, sentences, passages, timelines, reviews,
      oldRowsPreserved: true, baselineSha256: baseline.sha256,
      rebound: { alignments: bound.alignments, sentenceBatches: bound.sentenceBatches, reviewBatches: bound.reviewBatches }, database: after };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}
