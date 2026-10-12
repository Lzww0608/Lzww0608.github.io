import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadLibrary } from '../../content/library.mjs';
import { loadPublishedChapters } from '../../content/translations.mjs';
import { loadEventComparisons } from '../../content/event-comparisons.mjs';
import { buildReadingAnnotationChapters, loadReadingAnnotations, validateReadingAnnotationSources } from '../../content/reading-annotations.mjs';
import { matchesReadingAnnotationOccurrences, parseReadingAnnotationDocument, safeReadingAnnotationUrl } from '../src/reading-annotations-schema.ts';
import { readReadingAnnotations, hasReadingAnnotations } from '../src/reading-annotations-loader.ts';
import { splitReadingSpans } from '../src/sentence-alignment.ts';
import { paragraphTranslationParts, readSentenceTranslationParts } from '../src/sentence-translations-loader.ts';
import { simplifyOriginal } from '../src/script-converter.ts';
import { originalTextTag } from '../src/reading-headings.ts';

const sha = value => createHash('sha256').update(value).digest('hex');
const library = loadLibrary();
const published = loadPublishedChapters(library);
const comparisons = loadEventComparisons(library);
const byParagraph = new Map(published.flatMap(chapter => chapter.paragraphs.map(paragraph => [paragraph.id, paragraph])));
const paragraph = { ...byParagraph.get('old-v027-p18'), original: '𠮷節度使。柏鄉節度使！後文？未完尾文' };
const chapterId = 'old-v027';
const reference = { id: 'tang-officials', title: '唐代官制原文', url: 'https://zh.wikisource.org/wiki/舊唐書/卷44', locator: '卷四十四·職官志三', evidence: '测试仅用于验证出处字段保存，不替代实际注释研究。' };
const entry = { id: 'jiedushi', term: '節度使', kind: 'office', explanation: '测试官名解释，范围按当前底本绑定。', uncertainty: '测试保留语境限定。', referenceIds: [reference.id] };
const binding = { chapterId, paragraphId: paragraph.id, originalRevision: paragraph.revision, originalSha256: sha(paragraph.original), eventIds: ['baixiang'],
  occurrences: [{ entryId: entry.id, sentenceIndex: 0, originalStart: 1, originalEnd: 4 }, { entryId: entry.id, sentenceIndex: 1, originalStart: 7, originalEnd: 10 }] };
const document = { schemaVersion: 1, scope: 'current-archive', chapterId, eventIds: ['baixiang'], references: [reference], entries: [entry], paragraphs: [binding] };
const options = (fetcher = async () => Response.json(document)) => ({ paragraph, sentenceIndex: 0, archiveBase: '/', knownChapters: [chapterId], fetcher });

test('lightweight click locations suppress unsupported paragraph/sentence entries without authorizing source text', () => {
  const locations = [{ paragraphId: paragraph.id, sentenceIndices: [0, 1] }];
  assert.ok(hasReadingAnnotations(paragraph.id, 0, locations));
  assert.ok(hasReadingAnnotations(paragraph.id, 1, locations));
  assert.equal(hasReadingAnnotations(paragraph.id, 2, locations), false);
  assert.equal(hasReadingAnnotations('old-v027-p99', 0, locations), false);
  assert.equal(hasReadingAnnotations(paragraph.id, -1, locations), false);
  assert.equal(hasReadingAnnotations(paragraph.id, 0.5, locations), false);
  assert.equal(hasReadingAnnotations('not-a-paragraph', 0), false);
});

test('clicked canonical sentence resolves only its terms and citations, preserving source and translation', async () => {
  const before = JSON.stringify(paragraph);
  const urls = [];
  const fetcher = async (url, init) => { urls.push(url); assert.equal(init.credentials, 'omit'); return Response.json(document); };
  for (const sentenceIndex of [0, 1]) {
    const result = await readReadingAnnotations({ ...options(fetcher), sentenceIndex });
    assert.equal(result.status, 'available');
    assert.equal(result.annotations.length, 1);
    assert.equal(result.annotations[0].kind, 'office');
    assert.deepEqual(result.annotations[0].references, [reference]);
    assert.equal(result.annotations[0].uncertainty, entry.uncertainty);
  }
  for (const sentenceIndex of [2, 3, -1, 999, 0.5]) {
    assert.deepEqual(await readReadingAnnotations({ ...options(fetcher), sentenceIndex }), { status: 'available', annotations: [] });
  }
  assert.deepEqual(urls, ['/history/reading-annotations/old-v027.json']);
  assert.equal(JSON.stringify(paragraph), before);
});

test('canonical Unicode ranges retain rare characters and question/exclamation tail boundaries', () => {
  assert.deepEqual(splitReadingSpans(paragraph.original).map(span => [span.start, span.end]), [[0, 5], [5, 11], [11, 14], [14, 18]]);
  assert.ok(matchesReadingAnnotationOccurrences(binding, paragraph, [entry]));
  for (const modify of [value => value.occurrences[0].originalStart++, value => value.occurrences[0].originalEnd++,
    value => value.occurrences[0].sentenceIndex++, value => value.occurrences[1].originalStart--,
    value => value.occurrences[1].originalEnd = 12, value => value.occurrences[1].sentenceIndex = 3]) {
    const changed = structuredClone(binding); modify(changed);
    assert.equal(matchesReadingAnnotationOccurrences(changed, paragraph, [entry]), false);
  }
  // A converted display may have fewer code points; the caller still supplies
  // the canonical index, rather than applying display offsets to the original.
  const converted = '吉节度使。柏乡节度使！后文？未完';
  assert.notEqual([...converted].length, [...paragraph.original].length);
  assert.equal(splitReadingSpans(converted)[1].text, '柏乡节度使！');
  assert.ok(matchesReadingAnnotationOccurrences(binding, paragraph, [entry]));
});

test('changed API original at the same revision, later revisions and wrong sentence ranges suppress all stale notes', async () => {
  for (const changed of [{ ...paragraph, revision: paragraph.revision + 1 }, { ...paragraph, original: paragraph.original + '新增原文。' },
    { ...paragraph, original: paragraph.original.replace('𠮷', '吉') }]) {
    assert.deepEqual(await readReadingAnnotations({ ...options(), paragraph: changed }), { status: 'stale', annotations: [] });
  }
  const changed = structuredClone(document); changed.paragraphs[0].occurrences[0].sentenceIndex = 1;
  assert.deepEqual(await readReadingAnnotations(options(async () => Response.json(changed))), { status: 'stale', annotations: [] });
  const newerTranslation = { ...paragraph, translation: { ...paragraph.translation, version: paragraph.translation.version + 1, text: '新的已发布全文。' } };
  assert.equal((await readReadingAnnotations({ ...options(), paragraph: newerTranslation })).annotations[0].term, '節度使');
});

test('unknown chapters or uncovered paragraphs are quiet, without requesting original archives', async () => {
  let requests = 0;
  const fetcher = async () => { requests++; return Response.json(document); };
  assert.deepEqual(await readReadingAnnotations({ ...options(fetcher), knownChapters: [] }), { status: 'available', annotations: [] });
  assert.equal(requests, 0);
  assert.deepEqual(await readReadingAnnotations({ ...options(fetcher), paragraph: { ...paragraph, id: 'old-v027-p99' } }), { status: 'available', annotations: [] });
  assert.equal(requests, 1);
});

test('same-chapter concurrent clicks share a request; a caller cannot mutate cached citations', async () => {
  let requests = 0;
  const fetcher = async () => { requests++; await new Promise(resolve => setTimeout(resolve, 2)); return Response.json(document); };
  const [first, second] = await Promise.all([readReadingAnnotations(options(fetcher)), readReadingAnnotations({ ...options(fetcher), sentenceIndex: 1 })]);
  assert.equal(requests, 1);
  first.annotations[0].references[0].url = 'https://unwanted.invalid';
  assert.equal(second.annotations[0].references[0].url, reference.url);
  assert.equal((await readReadingAnnotations(options(fetcher))).annotations[0].references[0].url, reference.url);
});

test('terms follow their first actual occurrence within the clicked sentence instead of catalog order', async () => {
  const reordered = structuredClone(document);
  const place = { id: 'baixiang', term: '柏鄉', kind: 'place', explanation: '测试地名。', uncertainty: null, referenceIds: [reference.id] };
  reordered.entries = [entry, place];
  reordered.paragraphs[0].occurrences.unshift({ entryId: place.id, sentenceIndex: 1, originalStart: 5, originalEnd: 7 });
  const result = await readReadingAnnotations({ ...options(async () => Response.json(reordered)), sentenceIndex: 1 });
  assert.deepEqual(result.annotations.map(annotation => annotation.id), [place.id, entry.id]);
});

test('failed, invalid and HTTP-error metadata is unavailable and retried without any older text fallback', async () => {
  for (const invalid of [() => new Response('', { status: 404 }), () => new Response('', { status: 500 }), () => new Response('{bad'),
    () => Response.json({ ...document, chapterId: 'old-v028' }), () => { throw new TypeError('offline'); }]) {
    let requests = 0;
    const fetcher = async () => { requests++; return requests === 1 ? invalid() : Response.json(document); };
    assert.deepEqual(await readReadingAnnotations(options(fetcher)), { status: 'unavailable', annotations: [] });
    assert.equal((await readReadingAnnotations(options(fetcher))).annotations.length, 1);
    assert.equal(requests, 2);
  }
  assert.deepEqual(await readReadingAnnotations(options(() => { throw new TypeError('synchronous network failure'); })), { status: 'unavailable', annotations: [] });
});

test('abort before or during a click stops that subscriber while another click can use the shared request', async () => {
  const already = new AbortController(); already.abort();
  let requests = 0;
  await assert.rejects(readReadingAnnotations({ ...options(async () => { requests++; return Response.json(document); }), signal: already.signal }), error => error.name === 'AbortError');
  assert.equal(requests, 0);
  let resolveRequest;
  const fetcher = () => { requests++; return new Promise(resolve => { resolveRequest = resolve; }); };
  const controller = new AbortController();
  const cancelled = readReadingAnnotations({ ...options(fetcher), signal: controller.signal });
  const stillReading = readReadingAnnotations({ ...options(fetcher), sentenceIndex: 1 });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(cancelled, error => error.name === 'AbortError');
  resolveRequest(Response.json(document));
  assert.equal((await stillReading).annotations.length, 1);
  assert.equal(requests, 1);
});

test('schema rejects unknown/private fields, dangling scope/citations and malformed identities before fetching', () => {
  const mutations = [value => value.schemaVersion = 2, value => value.scope = 'all-history', value => value.eventIds.push('not-registered'),
    value => value.ownerPassword = 'private', value => value.references.push(value.references[0]), value => value.references[0].privateNote = 'private',
    value => value.entries.push(value.entries[0]), value => value.entries[0].referenceIds.push('missing'), value => value.entries[0].referenceIds.push(reference.id),
    value => value.entries[0].kind = 'invented', value => value.entries[0].uncertainty = true, value => value.entries[0].humanReviewed = true,
    value => value.paragraphs.push(value.paragraphs[0]), value => value.paragraphs[0].chapterId = 'unknown', value => value.paragraphs[0].paragraphId = 'old-v027-p0',
    value => value.paragraphs[0].originalRevision = 0, value => value.paragraphs[0].originalSha256 = 'bad', value => value.paragraphs[0].eventIds = ['huliu'],
    value => value.paragraphs[0].occurrences.push(value.paragraphs[0].occurrences[0]), value => value.paragraphs[0].occurrences[0].entryId = 'missing',
    value => value.paragraphs[0].occurrences[0].originalStart = -1, value => value.paragraphs[0].occurrences[0].originalEnd = 1,
    value => value.paragraphs[0].occurrences[0].sentenceIndex = 0.5, value => value.paragraphs[0].occurrences[0].privateNote = 'private',
    value => value.paragraphs[0].noneReason = '不能有记录又称无注释', value => value.paragraphs[0].occurrences = []];
  for (const mutate of mutations) {
    const changed = structuredClone(document); mutate(changed);
    assert.throws(() => parseReadingAnnotationDocument(changed, chapterId));
  }
  assert.throws(() => parseReadingAnnotationDocument(document));
  assert.throws(() => parseReadingAnnotationDocument(document, 'old-v028'));
});

test('citations allow public HTTPS primary references and reject executable, local, IP and credential destinations', () => {
  for (const unsafe of ['http://zh.wikisource.org/wiki/史', 'javascript:alert(1)', 'data:text/html,secret', 'file:///private/key',
    'https://name:password@zh.wikisource.org/wiki/史', 'https://localhost/a', 'https://foo.local/a', 'https://127.0.0.1/a',
    'https://[::1]/a', 'https://2130706433/a', 'https://127.1/a', 'https://ctext.org:444/a', 'https://ctext.org/a\n', 'https://ctext.org\\@bad/a']) {
    assert.equal(safeReadingAnnotationUrl(unsafe), false, unsafe);
    const changed = structuredClone(document); changed.references[0].url = unsafe;
    assert.throws(() => parseReadingAnnotationDocument(changed, chapterId));
  }
  assert.ok(safeReadingAnnotationUrl(reference.url));
  assert.ok(safeReadingAnnotationUrl('https://ctext.org/wiki.pl?if=gb&chapter=123#citation'));
});

function corpusFixture() {
  const selected = new Map();
  for (const comparison of comparisons) for (const source of comparison.sources) {
    const previous = selected.get(source.paragraphId);
    if (previous) previous.eventIds.push(comparison.id);
    else selected.set(source.paragraphId, { chapterId: source.chapterId, paragraphId: source.paragraphId, originalRevision: source.originalRevision,
      originalSha256: source.originalSha256, eventIds: [comparison.id], occurrences: [], noneReason: '测试无名物的审读登记；生产数据另行逐段研究。' });
  }
  return { schemaVersion: 1, scope: 'current-archive', eventIds: comparisons.map(comparison => comparison.id), references: [], entries: [], paragraphs: [...selected.values()] };
}

test('build validation requires the full selected battle corpus, exact events and current originals, without rewriting data', () => {
  const fixture = corpusFixture();
  const before = JSON.stringify([fixture, library, published]);
  assert.equal(validateReadingAnnotationSources(fixture, library, comparisons).paragraphs.length, new Set(comparisons.flatMap(comparison => comparison.sources.map(source => source.paragraphId))).size);
  for (const modify of [value => value.paragraphs.pop(), value => value.paragraphs[0].originalSha256 = '0'.repeat(64),
    value => value.paragraphs[0].originalRevision++, value => value.paragraphs[0].eventIds = ['huliu'], value => value.eventIds.pop()]) {
    const changed = structuredClone(fixture); modify(changed);
    assert.throws(() => validateReadingAnnotationSources(changed, library, comparisons));
  }
  const documents = buildReadingAnnotationChapters(fixture);
  assert.equal(documents.reduce((count, value) => count + value.paragraphs.length, 0), fixture.paragraphs.length);
  assert.equal(new Set(documents.map(value => value.chapterId)).size, documents.length);
  for (const value of documents) assert.ok(value.paragraphs.every(paragraph => paragraph.chapterId === value.chapterId));
  assert.equal(JSON.stringify([fixture, library, published]), before);
});

test('future comparisons outside the explicitly authorized annotation scope do not require unrelated notes', () => {
  const fixture = corpusFixture();
  const unrelated = { ...structuredClone(comparisons[0]), id: 'another-battle', sources: [{ ...comparisons[0].sources[0], paragraphId: 'old-v001-p1' }] };
  const checked = validateReadingAnnotationSources(fixture, library, [...comparisons, unrelated]);
  assert.equal(checked.paragraphs.length, fixture.paragraphs.length);
  assert.deepEqual(checked.eventIds, fixture.eventIds);
  assert.throws(() => validateReadingAnnotationSources(fixture, library, comparisons.filter(comparison => comparison.id !== 'huliu')));
});

test('the selected unpunctuated Kaoyi paragraph remains audited, readable prose without fabricated click annotations', () => {
  const checked = loadReadingAnnotations(library, comparisons);
  const current = byParagraph.get('kaoyi-v029-p14');
  const binding = checked.paragraphs.find(paragraph => paragraph.paragraphId === current.id);
  assert.ok(binding);
  assert.equal(originalTextTag(current), 'p');
  assert.equal(splitReadingSpans(current.original).filter(span => /[。？！]/u.test(span.text)).length, 0);
  assert.deepEqual(binding.occurrences, []);
  assert.ok(binding.noneReason.trim());
  for (const displayedOriginal of [current.original, simplifyOriginal(current.original)]) {
    const parts = paragraphTranslationParts(current, displayedOriginal);
    assert.equal(parts.map(part => part.original).join(''), displayedOriginal);
    assert.ok(parts.every(part => part.kind === 'unavailable' && part.translation === null));
  }
  assert.equal(hasReadingAnnotations(current.id, 0), false);
});

test('real battle annotations resolve every registered occurrence under both scripts with the actual independent sentence translations', async () => {
  const checked = loadReadingAnnotations(library, comparisons);
  const documents = buildReadingAnnotationChapters(checked);
  const byChapter = new Map(documents.map(document => [document.chapterId, document]));
  const requests = [];
  const fetcher = async url => {
    requests.push(url);
    const noteChapter = /\/reading-annotations\/([a-z]+-v\d+)\.json$/.exec(url)?.[1];
    if (noteChapter) return Response.json(byChapter.get(noteChapter));
    const sentenceChapter = /\/sentence-alignments\/([a-z]+-v\d+)\.json$/.exec(url)?.[1];
    if (sentenceChapter) return Response.json(JSON.parse(readFileSync(new URL(`../../content/sentence-alignments/chapters/${sentenceChapter}.json`, import.meta.url), 'utf8')));
    const supplementChapter = /\/sentence-translations\/([a-z]+-v\d+)\.json$/.exec(url)?.[1];
    if (supplementChapter) return Response.json(JSON.parse(readFileSync(new URL(`../../content/published-sentence-translations/${supplementChapter}.json`, import.meta.url), 'utf8')));
    throw new Error(`Unexpected archive request: ${url}`);
  };
  const before = JSON.stringify(published);
  let checkedOccurrences = 0;
  for (const binding of checked.paragraphs) {
    const current = byParagraph.get(binding.paragraphId);
    const indices = new Set(binding.occurrences.map(occurrence => occurrence.sentenceIndex));
    for (const displayedOriginal of [current.original, simplifyOriginal(current.original)]) {
      const parts = await readSentenceTranslationParts({ paragraph: current, displayedOriginal, archiveBase: '/', apiBase: '', fetcher });
      for (const sentenceIndex of indices) {
        assert.ok(hasReadingAnnotations(current.id, sentenceIndex), `${current.id} missing click manifest ${sentenceIndex}`);
        const expectedIds = new Set(binding.occurrences.filter(occurrence => occurrence.sentenceIndex === sentenceIndex).map(occurrence => occurrence.entryId));
        const result = await readReadingAnnotations({ paragraph: current, sentenceIndex, archiveBase: '/', fetcher });
        assert.equal(result.status, 'available');
        assert.deepEqual(new Set(result.annotations.map(annotation => annotation.id)), expectedIds);
        assert.equal(parts[sentenceIndex].id, `${current.id}-sentence-${sentenceIndex}`);
        assert.equal(parts[sentenceIndex].kind, 'sentence', `actual independent translation required: ${current.id} sentence ${sentenceIndex}`);
        assert.ok(parts[sentenceIndex].translation?.trim());
        for (const annotation of result.annotations) {
          assert.ok(splitReadingSpans(current.original)[sentenceIndex].text.includes(annotation.term));
          assert.ok(annotation.references.length);
          assert.ok(annotation.references.every(reference => safeReadingAnnotationUrl(reference.url) && reference.locator.trim()));
        }
        checkedOccurrences += binding.occurrences.filter(occurrence => occurrence.sentenceIndex === sentenceIndex).length;
      }
    }
  }
  assert.equal(checkedOccurrences, checked.paragraphs.reduce((count, binding) => count + binding.occurrences.length, 0) * 2);
  assert.equal(JSON.stringify(published), before);
  assert.equal(requests.filter(url => url.includes('/reading-annotations/')).length,
    documents.filter(document => document.paragraphs.some(paragraph => paragraph.occurrences.length)).length);
});
