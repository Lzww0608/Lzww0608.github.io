import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { loadLibrary } from '../../content/library.mjs';
import { loadPublishedChapters } from '../../content/translations.mjs';
import { paragraphTranslationParts, readSentenceTranslationParts } from '../src/sentence-translations-loader.ts';
import { sliceCodePoints, splitPeriodSpans } from '../src/sentence-alignment.ts';
import { originalTextTag } from '../src/reading-headings.ts';

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

test('a broader group never supplies the same multi-sentence translation to separate full-stop targets', async () => {
  const index = indexFor();
  index.paragraphs[0].groups = [{ originalStart: 0, originalEnd: size(paragraph.original), translationStart: 0, translationEnd: size(paragraph.translation.text), kind: 'group' }];
  const parts = await readSentenceTranslationParts(options(paragraph, async () => Response.json(index)));
  assert.notEqual(parts[0].groupId, parts[1].groupId);
  assert.ok(parts.every(part => part.kind === 'unaligned' && part.translation === null));
});

test('new API versions and changed originals suspend old ranges without a whole-paragraph popup', async () => {
  for (const value of [
    { ...paragraph, translation: { ...paragraph.translation, id: '902', version: 2, text: '所有者新校订的整段译文。' } },
    { ...paragraph, original: '甲𠮷發兵攻城。乙勝而還營。', revision: 2 },
    { ...paragraph, translation: { ...paragraph.translation, text: '同号但正文已变的译文。' } },
    { ...paragraph, original: '甲𠮷發兵攻城。乙未還營。' },
  ]) {
    const parts = await readSentenceTranslationParts(options(value));
    assert.ok(parts.every(part => part.kind === 'unaligned' && part.translation === null));
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
    assert.ok(parts.every(part => part.kind === 'unaligned' && part.translation === null));
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

test('offline, malformed and missing indexes do not expand a sentence popup to a paragraph', async () => {
  for (const fetcher of [async () => { throw new TypeError('offline'); }, async () => new Response('', { status: 404 }), async () => Response.json({ schemaVersion: 1 })]) {
    const parts = await readSentenceTranslationParts(options(paragraph, fetcher));
    assert.ok(parts.every(part => part.kind === 'unaligned' && part.translation === null));
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
  assert.ok(first.every(part => part.kind === 'unaligned'));
  assert.ok(later.every(part => part.kind === 'sentence'));
  assert.equal(calls, 2);
});

test('the reported summer appointment sentence excludes the following Gengwu event', async () => {
  const chapter = loadPublishedChapters(loadLibrary()).find(chapter => chapter.id === 'old-v103');
  const paragraph = chapter.paragraphs.find(paragraph => paragraph.id === 'old-v103-p4');
  const document = JSON.parse(readFileSync(new URL('../../content/sentence-alignments/chapters/old-v103.json', import.meta.url), 'utf8'));
  const parts = await readSentenceTranslationParts(options(paragraph, async () => Response.json(document)));
  assert.equal(parts[0].original, '夏四月戊辰朔，邢州薛懷讓移鎮同州，相州郭謹、河陽李暉並進邑封。');
  assert.equal(parts[0].translation, '夏季四月戊辰朔日，邢州薛怀让移镇同州，相州郭谨、河阳李晖都增加食邑、封爵。');
  assert.equal(parts[1].original, '庚午，府州折從阮移鎮鄧州。');
  assert.equal(parts[1].translation, '庚午，府州折从阮移镇邓州。');
  assert.ok(parts.every(part => part.kind === 'sentence' && (part.original.match(/。/gu) ?? []).length <= 1));
});

test('all explicitly checked full-stop ranges expose separate originals and only their own translation slices', async () => {
  const chapters = loadPublishedChapters(loadLibrary());
  let count = 0, expectedCount = 0;
  for (const chapter of chapters) {
    const document = JSON.parse(readFileSync(new URL(`../../content/sentence-alignments/chapters/${chapter.id}.json`, import.meta.url), 'utf8'));
    const fetcher = async () => Response.json(document);
    for (const paragraph of chapter.paragraphs) {
      const alignment = document.paragraphs.find(entry => entry.paragraphId === paragraph.id);
      if (!alignment?.periodSentences) continue;
      const units = splitPeriodSpans(paragraph.original);
      expectedCount += units.length;
      const parts = await readSentenceTranslationParts(options(paragraph, fetcher));
      assert.equal(parts.map(part => part.original).join(''), paragraph.original);
      assert.equal(parts.length, units.length, paragraph.id);
      for (const [index, part] of parts.entries()) {
        const range = alignment.periodSentences[index], unit = units[index];
        assert.equal(range.originalStart, unit.start, `${paragraph.id}: unit start`);
        assert.equal(range.originalEnd, unit.end, `${paragraph.id}: unit end`);
        if (unit.text.includes('。') || originalTextTag(paragraph) !== 'p') {
          assert.equal(part.kind, 'sentence', `${paragraph.id}: clickable unit ${index}`);
          assert.equal(part.translation, sliceCodePoints(paragraph.translation.text, range.translationStart, range.translationEnd),
            `${paragraph.id}: exact translation slice ${index}`);
        } else {
          assert.equal(part.kind, 'unavailable', `${paragraph.id}: unpunctuated trailing prose`);
          assert.equal(part.translation, null);
        }
      }
      assert.equal(new Set(parts.map(part => part.groupId)).size, parts.length);
      assert.ok(parts.every(part => (part.original.match(/。/gu) ?? []).length <= 1), paragraph.id);
      count += parts.length;
    }
  }
  assert.equal(count, expectedCount);
  assert.ok(count > 208, 'checked new source units supplement the existing 208 mappings');
});

test('an oversized period range is rejected instead of restoring a broad paragraph popup', async () => {
  const document = indexFor();
  document.paragraphs[0].periodSentences = [{ originalStart: 0, originalEnd: size(paragraph.original), translationStart: 0, translationEnd: size(paragraph.translation.text) }];
  const parts = await readSentenceTranslationParts(options(paragraph, async () => Response.json(document)));
  assert.ok(parts.every(part => part.kind === 'unaligned' && part.translation === null));
});

test('the reported New History foreign-envoy sentence has its own translation', async () => {
  const chapter=loadPublishedChapters(loadLibrary()).find(c=>c.id==='new-v06');
  const p=chapter.paragraphs.find(p=>p.id==='new-v06-p16');
  const document=JSON.parse(readFileSync(new URL('../../content/sentence-alignments/chapters/new-v06.json',import.meta.url)));
  const parts=await readSentenceTranslationParts(options(p,async()=>Response.json(document)));
  const part=parts.find(part=>part.original.includes('列六'));
  assert.equal(part.kind,'sentence');assert.equal(part.translation,'庚辰，达靼派列六薛娘居前来。');
});
test('cross-review regressions keep a complete predicate and the next sentence’s question in their own units', async()=>{
  const chapters=loadPublishedChapters(loadLibrary());
  const load=async(chapterId,paragraphId)=>{const p=chapters.find(c=>c.id===chapterId).paragraphs.find(p=>p.id===paragraphId);const d=JSON.parse(readFileSync(new URL(`../../content/sentence-alignments/chapters/${chapterId}.json`,import.meta.url)));return readSentenceTranslationParts(options(p,async()=>Response.json(d)));};
  const old=await load('old-v078','old-v078-p2');assert.equal(old[9].translation,'若剪裁其中的文字，就会使记载不完备；');assert.match(old[10].translation,/^记载不完备便会引发争论/);
  const shibu=await load('shibu-v002','shibu-v002-p14');assert.doesNotMatch(shibu[5].translation,/疑惑|老妇答/);assert.match(shibu[6].translation,/^高季兴疑惑，问她原因。老妇答/);
});
