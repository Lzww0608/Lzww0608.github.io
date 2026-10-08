import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { paragraphTranslationParts, readSentenceTranslationParts } from '../src/sentence-translations-loader.ts';

const hash = text => createHash('sha256').update(text).digest('hex');
const size = text => Array.from(text).length;
const paragraph = {
  id: 'new-v99-p1', position: 1, revision: 1, original: '甲𠮷發兵攻城。乙還營。',
  translation: { id: '901', version: 1, text: '甲𠮷率军攻打城池。乙回到营地。', language: 'zh-Hans', translator: '测试译者' },
};

function indexFor(value = paragraph) {
  const originalBoundary = size('甲𠮷發兵攻城。');
  const translationBoundary = size('甲𠮷率军攻打城池。');
  return { schemaVersion: 1, chapterId: 'new-v99', paragraphs: [{
    paragraphId: value.id, originalRevision: value.revision, originalSha256: hash(value.original),
    translationId: value.translation.id, translationVersion: value.translation.version,
    translationSha256: hash(value.translation.text), groups: [
      { originalStart: 0, originalEnd: originalBoundary, translationStart: 0, translationEnd: translationBoundary, kind: 'sentence' },
      { originalStart: originalBoundary, originalEnd: size(value.original), translationStart: translationBoundary, translationEnd: size(value.translation.text), kind: 'sentence' },
    ],
  }] };
}

const options = (value = paragraph, fetcher = async () => Response.json(indexFor())) => ({
  paragraph: value, displayedOriginal: value.original, archiveBase: '/', fetcher,
});

test('checked Unicode ranges display the matching sentence without clipping rare characters', async () => {
  const parts = await readSentenceTranslationParts(options());
  assert.deepEqual(parts.map(part => part.translation), ['甲𠮷率军攻打城池。', '乙回到营地。']);
  assert.equal(parts.map(part => part.original).join(''), paragraph.original);
  assert.ok(parts.every(part => part.kind === 'sentence'));
});

test('Simplified display uses canonical sentence boundaries even when display lengths differ', async () => {
  const displayedOriginal = '甲𠮷发兵攻城。乙回到了营地。';
  const parts = await readSentenceTranslationParts({ ...options(), displayedOriginal });
  assert.equal(parts.map(part => part.original).join(''), displayedOriginal);
  assert.equal(parts[1].translation, '乙回到营地。');
});

test('a checked many-to-one group is shared by both source sentences and labeled as a group', async () => {
  const index = indexFor();
  index.paragraphs[0].groups = [{ originalStart: 0, originalEnd: size(paragraph.original), translationStart: 0, translationEnd: size(paragraph.translation.text), kind: 'group' }];
  const parts = await readSentenceTranslationParts(options(paragraph, async () => Response.json(index)));
  assert.equal(parts[0].groupId, parts[1].groupId);
  assert.ok(parts.every(part => part.kind === 'group' && part.translation === paragraph.translation.text));
});

test('new API versions and changed originals suspend archived ranges and show the current whole paragraph', async () => {
  for (const value of [
    { ...paragraph, translation: { ...paragraph.translation, id: '902', version: 2, text: '所有者新校订的整段译文。' } },
    { ...paragraph, original: '甲𠮷發兵攻城。乙勝而還營。', revision: 2 },
    { ...paragraph, translation: { ...paragraph.translation, text: '同号但正文已变的译文。' } },
    { ...paragraph, original: '甲𠮷發兵攻城。乙未還營。' },
  ]) {
    const parts = await readSentenceTranslationParts(options(value));
    assert.ok(parts.every(part => part.kind === 'paragraph' && part.translation === value.translation.text));
    assert.equal(parts.map(part => part.original).join(''), value.original);
  }
});

test('wrong chapters, partial ranges and a false single-sentence classification cannot replace fallback text', async () => {
  const incorrect = indexFor(); incorrect.chapterId = 'new-v98'; incorrect.paragraphs[0].paragraphId = 'new-v98-p1';
  const partial = indexFor(); partial.paragraphs[0].groups.at(-1).translationEnd -= 1;
  const fakeSentence = indexFor(); fakeSentence.paragraphs[0].groups = [{ originalStart: 0, originalEnd: size(paragraph.original), translationStart: 0, translationEnd: size(paragraph.translation.text), kind: 'sentence' }];
  const splitWord = indexFor(); splitWord.paragraphs[0].groups[0].originalEnd -= 1; splitWord.paragraphs[0].groups[1].originalStart -= 1;
  for (const index of [incorrect, partial, fakeSentence, splitWord]) {
    const parts = await readSentenceTranslationParts(options(paragraph, async () => Response.json(index)));
    assert.ok(parts.every(part => part.kind === 'paragraph'));
  }
});

test('one chapter request serves multiple paragraph lookups without sharing their translation text', async () => {
  const second = { ...paragraph, id: 'new-v99-p2', translation: { ...paragraph.translation, id: '903' } };
  const index = indexFor(); index.paragraphs.push(indexFor(second).paragraphs[0]);
  const calls = [];
  const fetcher = async (url, config) => { calls.push({ url, credentials: config.credentials }); return Response.json(index); };
  const [firstParts, secondParts] = await Promise.all([
    readSentenceTranslationParts(options(paragraph, fetcher)), readSentenceTranslationParts(options(second, fetcher)),
  ]);
  assert.deepEqual(calls, [{ url: '/history/sentence-alignments/new-v99.json', credentials: 'omit' }]);
  assert.ok(firstParts.every(part => part.id.startsWith(paragraph.id)));
  assert.ok(secondParts.every(part => part.id.startsWith(second.id)));
});

test('offline, malformed and missing indexes preserve current paragraph translations with explicit scope', async () => {
  for (const fetcher of [async () => { throw new TypeError('offline'); }, async () => new Response('', { status: 404 }), async () => Response.json({ schemaVersion: 1 })]) {
    const parts = await readSentenceTranslationParts(options(paragraph, fetcher));
    assert.ok(parts.every(part => part.kind === 'paragraph' && part.translation === paragraph.translation.text));
  }
  const withoutTranslation = { ...paragraph, translation: null };
  assert.ok(paragraphTranslationParts(withoutTranslation, withoutTranslation.original).every(part => part.kind === 'unavailable' && part.translation === null));
});

test('an aborted reading view never receives late sentence ranges', async () => {
  const controller = new AbortController();
  const task = readSentenceTranslationParts({ ...options(paragraph, async () => { controller.abort(); return Response.json(indexFor()); }), signal: controller.signal });
  await assert.rejects(task, { name: 'AbortError' });
});

test('a failed index request can recover on a later visit without a page reload', async () => {
  let calls = 0;
  const fetcher = async () => ++calls === 1 ? new Response('', { status: 503 }) : Response.json(indexFor());
  const first = await readSentenceTranslationParts(options(paragraph, fetcher));
  const later = await readSentenceTranslationParts(options(paragraph, fetcher));
  assert.ok(first.every(part => part.kind === 'paragraph'));
  assert.ok(later.every(part => part.kind === 'sentence'));
  assert.equal(calls, 2);
});
