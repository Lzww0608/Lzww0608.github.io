import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadLibrary } from '../../content/library.mjs';
import { loadPublishedChapters } from '../../content/translations.mjs';
import * as alignmentTools from '../src/sentence-alignment.ts';
import { paragraphTranslationParts, readSentenceTranslationParts } from '../src/sentence-translations-loader.ts';
import { originalTextTag } from '../src/reading-headings.ts';

const size = text => [...text].length;
const hash = text => createHash('sha256').update(text).digest('hex');
const { sliceCodePoints, splitPeriodSpans, validateSentenceAlignmentDocument } = alignmentTools;
const chapters = loadPublishedChapters(loadLibrary());
const reported = chapters.find(chapter => chapter.id === 'new-v64').paragraphs.find(paragraph => paragraph.id === 'new-v64-p20');
const reportedIndex = JSON.parse(readFileSync(new URL('../../content/sentence-alignments/chapters/new-v64.json', import.meta.url), 'utf8'));
const reportedLegacy = reportedIndex.paragraphs.find(paragraph => paragraph.paragraphId === reported.id);
const reportedTails = [
  { originalStart: 52, originalEnd: 82, translationStart: 70, translationEnd: 115 },
  { originalStart: 82, originalEnd: 130, translationStart: 115, translationEnd: 177 },
];

function reportedDocument() {
  const paragraph = structuredClone(reportedLegacy);
  paragraph.tailSentences = structuredClone(reportedTails);
  return { schemaVersion: 1, chapterId: 'new-v64', paragraphs: [paragraph] };
}

function options(paragraph, document, displayedOriginal = paragraph.original) {
  return { paragraph, displayedOriginal, archiveBase: '/', fetcher: async () => Response.json(document) };
}

// Fixtures specify their meanings explicitly. No alignment is inferred from equal
// sentence counts or from relative source/translation lengths.
function fixture(originalParts, translations, id = 'new-v99-p1') {
  assert.equal(originalParts.length, translations.length);
  const paragraph = {
    id, position: 1, revision: 1, original: originalParts.join(''),
    translation: { id: '9901', version: 1, text: translations.join(''), language: 'zh-Hans', translator: '测试译者' },
  };
  let sourceEnd = 0, translatedEnd = 0;
  const ranges = originalParts.map((original, index) => {
    const range = { originalStart: sourceEnd, originalEnd: sourceEnd + size(original), translationStart: translatedEnd, translationEnd: translatedEnd + size(translations[index]) };
    sourceEnd = range.originalEnd;
    translatedEnd = range.translationEnd;
    return range;
  });
  const periods = splitPeriodSpans(paragraph.original);
  const periodSentences = periods.map(span => {
    const first = ranges.find(range => range.originalStart === span.start);
    const last = ranges.find(range => range.originalEnd === span.end);
    assert.ok(first && last, 'fixture period boundaries must match explicitly specified pieces');
    return { originalStart: span.start, originalEnd: span.end, translationStart: first.translationStart, translationEnd: last.translationEnd };
  });
  const tailStart = periods.find(span => !span.text.includes('。'))?.start;
  const alignment = {
    paragraphId: id, originalRevision: 1, originalSha256: hash(paragraph.original),
    translationId: paragraph.translation.id, translationVersion: 1, translationSha256: hash(paragraph.translation.text),
    groups: [{ originalStart: 0, originalEnd: sourceEnd, translationStart: 0, translationEnd: translatedEnd, kind: 'paragraph' }],
    periodSentences,
    ...(tailStart === undefined ? {} : { tailSentences: ranges.filter(range => range.originalStart >= tailStart) }),
  };
  return { paragraph, document: { schemaVersion: 1, chapterId: /^(.*)-p\d+$/.exec(id)[1], paragraphs: [alignment] }, ranges };
}

test('the reported 有上書者 tail exposes two independent translations after the unchanged full-stop targets', async () => {
  const document = reportedDocument();
  const parts = await readSentenceTranslationParts(options(reported, document));
  assert.equal(parts.length, 4, 'the question/exclamation tail must not remain one unavailable block');
  assert.deepEqual(parts.map(part => part.original), [
    sliceCodePoints(reported.original, 0, 26), sliceCodePoints(reported.original, 26, 52),
    '有上書者，言臺省官當擇清流，昶歎曰：「何不言擇其人而任之？」',
    '左右請以其言詰上書者，昶曰：「吾見唐太宗初即位，獄吏孫伏伽上書言事，皆見嘉納，奈何勸我拒諫耶！」',
  ]);
  assert.deepEqual(parts.map(part => part.translation), [
    sliceCodePoints(reported.translation.text, 0, 31), sliceCodePoints(reported.translation.text, 31, 70),
    '有人上书，说台省官员应当从清贵的士人中选拔；孟昶叹道：“为什么不说要选择合适的人再任用？”',
    '左右请他用这句话责问上书者，孟昶说：“我看到唐太宗刚即位时，狱吏孙伏伽上书议事，都得到嘉奖和采纳，怎么反倒劝我拒绝进谏呢！”',
  ]);
  assert.ok(parts.every(part => part.kind === 'sentence'));
  assert.equal(new Set(parts.map(part => part.groupId)).size, 4);
  assert.equal(parts.map(part => part.original).join(''), reported.original);
  assert.deepEqual(document.paragraphs[0].periodSentences, reportedLegacy.periodSentences, 'tail support does not rewrite the old period correspondence');
});

test('tail reading spans preserve old full-stop units, Unicode, closing notes, quotes and whitespace', () => {
  assert.equal(typeof alignmentTools.splitReadingSpans, 'function', 'the reading splitter must refine only the unpunctuated period tail');
  assert.equal(typeof alignmentTools.isClickableReadingSpan, 'function');
  const text = '甲曰：「何故？試之。」\n乙還。𠮷曰：「何故？！」\n〈注：可再試？〉仍未完';
  const periods = splitPeriodSpans(text);
  const spans = alignmentTools.splitReadingSpans(text);
  assert.deepEqual(spans.map(span => span.text), ['甲曰：「何故？試之。」\n', '乙還。', '𠮷曰：「何故？！」\n', '〈注：可再試？〉', '仍未完']);
  assert.deepEqual(spans.slice(0, 2), periods.slice(0, 2));
  assert.equal(spans.map(span => span.text).join(''), text);
  assert.ok(spans.every(span => sliceCodePoints(text, span.start, span.end) === span.text));
  assert.deepEqual(spans.map(span => alignmentTools.isClickableReadingSpan(span.text)), [true, true, true, true, false]);
  assert.deepEqual(alignmentTools.splitReadingSpans(''), []);
});

test('a question or exclamation before a Chinese full stop stays in its original click unit', async () => {
  const source = ['甲曰：「何故？敢戰！」乙還。', '後問：「可再來？」'];
  const translations = ['甲问：“为什么？敢不敢作战！”乙返回。', '后来问：“能再来吗？”'];
  const { paragraph, document } = fixture(source, translations);
  const parts = await readSentenceTranslationParts(options(paragraph, document));
  assert.deepEqual(parts.map(part => part.original), source);
  assert.deepEqual(parts.map(part => part.translation), translations);
  assert.ok(parts.every(part => part.kind === 'sentence'));
});

test('Simplified display uses the canonical tail ranges even when displayed character counts differ', async () => {
  const source = ['𠮷王發兵。', '將領曰：「何不還營？」', '部曲答：「尚可再戰！」', '無句讀尾文'];
  const translations = ['𠮷王出兵。', '将领说：“为什么不回营？”', '部曲回答：“还可以再战！”', '没有句读的尾文'];
  const { paragraph, document } = fixture(source, translations);
  const displayed = ['𠮷王发兵。', '将领说：「何不返回营地？」', '部曲答：「尚可再战！」', '无句读尾文'];
  const parts = await readSentenceTranslationParts(options(paragraph, document, displayed.join('')));
  assert.deepEqual(parts.map(part => part.original), displayed);
  assert.deepEqual(parts.map(part => part.translation), [...translations.slice(0, 3), null]);
  assert.deepEqual(parts.map(part => part.kind), ['sentence', 'sentence', 'sentence', 'unavailable']);
  assert.equal(parts.map(part => part.original).join(''), displayed.join(''));
});

test('quoted and annotated tail questions each use only their checked translation while unfinished prose stays plain', async () => {
  const source = ['王還。', '〈注：孰為先？〉\n', '王曰：「吾先也！」 ', '後事未完'];
  const translations = ['王返回。', '〈注：谁在前？〉\n', '王说：“我在前！” ', '后面的事情尚未叙完'];
  const { paragraph, document } = fixture(source, translations);
  const parts = await readSentenceTranslationParts(options(paragraph, document));
  assert.deepEqual(parts.map(part => part.original), source);
  assert.deepEqual(parts.map(part => part.translation), [translations[0], translations[1], translations[2], null]);
  assert.deepEqual(parts.map(part => part.kind), ['sentence', 'sentence', 'sentence', 'unavailable']);
  assert.notEqual(parts[1].groupId, parts[2].groupId);
});

test('unpunctuated prose remains unavailable and verified headings retain their complete translation', async () => {
  const paragraph = { ...reported, id: 'new-v99-p1', original: '未完的無句讀尾文', translation: { ...reported.translation, text: '尚未结束的无句读尾文' } };
  assert.deepEqual(paragraphTranslationParts(paragraph, paragraph.original).map(part => [part.original, part.kind, part.translation]), [[paragraph.original, 'unavailable', null]]);
  const heading = chapters.flatMap(chapter => chapter.paragraphs).find(paragraph => !paragraph.original.includes('。') && originalTextTag(paragraph) !== 'p');
  assert.ok(heading, 'the current corpus supplies a genuinely verified source heading');
  const parts = await readSentenceTranslationParts({ ...options(heading, {}), fetcher: async () => new Response('', { status: 404 }) });
  assert.equal(parts.length, 1);
  assert.equal(parts[0].kind, 'sentence');
  assert.equal(parts[0].translation, heading.translation.text);
});

test('a broader legacy tail range never supplies both completed tail sentences to either popup', async () => {
  const document = reportedDocument();
  delete document.paragraphs[0].tailSentences;
  const parts = await readSentenceTranslationParts(options(reported, document));
  assert.equal(parts.length, 4);
  assert.deepEqual(parts.slice(0, 2).map(part => part.kind), ['sentence', 'sentence']);
  assert.ok(parts.slice(2).every(part => part.kind === 'unaligned' && part.translation === null));
});

test('revised originals and full translations suspend the checked tail slices without restoring old or whole-paragraph text', async () => {
  for (const paragraph of [
    { ...reported, revision: 2 },
    { ...reported, original: reported.original.replace('清流', '清官') },
    { ...reported, translation: { ...reported.translation, id: '999999', version: 2 } },
    { ...reported, translation: { ...reported.translation, version: 2 } },
    { ...reported, translation: { ...reported.translation, text: `${reported.translation.text}新的校核。` } },
  ]) {
    const parts = await readSentenceTranslationParts(options(paragraph, reportedDocument()));
    assert.equal(parts.length, 4);
    assert.ok(parts.every(part => part.kind === 'unaligned' && part.translation === null));
    assert.equal(parts.map(part => part.original).join(''), paragraph.original);
  }
});

test('tail schema rejects omitted coverage, overlapping offsets and translation ranges extending outside the old tail', () => {
  const mutate = change => { const document = reportedDocument(); change(document.paragraphs[0]); return document; };
  for (const [description, document] of [
    ['missing final tail sentence', mutate(paragraph => { paragraph.tailSentences.pop(); })],
    ['source prefix overlaps the preceding full stop', mutate(paragraph => { paragraph.tailSentences[0].originalStart = 51; })],
    ['overlapping tail source ranges', mutate(paragraph => { paragraph.tailSentences[1].originalStart = 81; })],
    ['translation prefix overlaps the preceding full stop', mutate(paragraph => { paragraph.tailSentences[0].translationStart = 69; })],
    ['tail translation exceeds the published text', mutate(paragraph => { paragraph.tailSentences[1].translationEnd = 178; })],
    ['empty tail coverage', mutate(paragraph => { paragraph.tailSentences = []; })],
  ]) assert.throws(() => validateSentenceAlignmentDocument(document), undefined, description);
});

test('a schema-contiguous tail boundary inside a word is rejected by the real loader', async () => {
  const document = reportedDocument();
  document.paragraphs[0].tailSentences[0].originalEnd = 81;
  document.paragraphs[0].tailSentences[1].originalStart = 81;
  const parts = await readSentenceTranslationParts(options(reported, document));
  assert.equal(parts.length, 4);
  assert.ok(parts.every(part => part.kind === 'unaligned' && part.translation === null));
});
