import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadLibrary } from '../../content/library.mjs';
import { alignSentenceGroups, buildSentenceAlignmentDocuments, sentenceAlignmentsRoot } from '../../scripts/index-sentence-alignments.mjs';
import { findAlignmentGroup, findSentenceAlignment, hasOuterSentencePunctuation, matchesSentenceAlignment, sliceCodePoints, splitSentenceSpans, validateSentenceAlignmentDocument } from '../src/sentence-alignment.ts';

const library = loadLibrary();
const originals = new Map(library.chapters.flatMap(chapter => chapter.paragraphs.map(paragraph => [paragraph.id, paragraph])));
const translations = new Map(library.catalog.books.flatMap(book => JSON.parse(readFileSync(new URL(`../../content/published-translations/${book.id}.json`, import.meta.url), 'utf8')).entries.map(entry => [entry.paragraphId, entry.translation])));
const documents = buildSentenceAlignmentDocuments(library);
const alignments = new Map(documents.flatMap(document => document.paragraphs.map(paragraph => [paragraph.paragraphId, paragraph])));
const sha256 = text => createHash('sha256').update(text).digest('hex');

test('splits on sentence punctuation and preserves every Unicode character, quotes, notes and whitespace', () => {
  const text = '𠮷王曰：「發兵！？」\n〈注：已見前卷。〉後還。無句讀尾';
  const spans = splitSentenceSpans(text);
  assert.deepEqual(spans.map(span => span.text), ['𠮷王曰：「發兵！？」\n', '〈注：已見前卷。〉', '後還。', '無句讀尾']);
  assert.equal(spans.map(span => span.text).join(''), text);
  assert.equal(spans[0].end, [...spans[0].text].length);
  for (const span of spans) assert.equal(sliceCodePoints(text, span.start, span.end), span.text);
  assert.deepEqual(splitSentenceSpans(''), []);
  assert.deepEqual(splitSentenceSpans('北夢瑣言無句讀'), [{ start: 0, end: 7, text: '北夢瑣言無句讀' }]);
});

test('never invents a sentence correspondence from equal sentence counts or proportional lengths', () => {
  const original = '懼而不發。遂還。';
  const translation = '他害怕，不敢進攻。他於是返回。';
  assert.deepEqual(alignSentenceGroups(original, translation), [{ originalStart: 0, originalEnd: [...original].length, translationStart: 0, translationEnd: [...translation].length, kind: 'paragraph' }]);
  assert.equal(alignSentenceGroups('亂離以來官爵過濫封王作輔', '战乱以来，授官过于泛滥。封王的人很多。')[0].kind, 'paragraph');
});

test('unique consistent anchors allow one-to-many and many-to-one groups without ordinal pairing', () => {
  const original = '甲午，某城发生蝗灾，灾情遍及三县。乙未，节度使郭威加同平章事。丙申，李存孝回到晋国。';
  const translation = '甲午，某城发生蝗灾。灾情遍及三县。乙未，节度使郭威加同平章事；丙申，李存孝回到晋国。';
  const groups = alignSentenceGroups(original, translation);
  assert.equal(splitSentenceSpans(original).length, splitSentenceSpans(translation).length);
  assert.deepEqual(groups.map(group => group.kind), ['sentence', 'group']);
  assert.equal(sliceCodePoints(translation, groups[0].translationStart, groups[0].translationEnd), '甲午，某城发生蝗灾。灾情遍及三县。');
  assert.equal(sliceCodePoints(original, groups[1].originalStart, groups[1].originalEnd), '乙未，节度使郭威加同平章事。丙申，李存孝回到晋国。');
  const reversed = alignSentenceGroups('甲午，某城发生蝗灾。乙未，节度使郭威加同平章事。', '乙未，节度使郭威加同平章事。甲午，某城发生蝗灾。');
  assert.equal(reversed[0].kind, 'paragraph');
  assert.equal(reversed.length, 1);
});

test('embedded editorial-note punctuation never splits the surrounding sentence or office title', () => {
  const title = '改授鄆州刺史、天平軍節度、鄆齊〈（原本闕一字。）〉等州觀察處置等使，賜鐵券。';
  assert.deepEqual(splitSentenceSpans(title).map(span => span.text), [title]);
  assert.equal(hasOuterSentencePunctuation('〈一注。二注。〉'), false);
  assert.equal(hasOuterSentencePunctuation('無外層句讀〈（注內有句讀。）〉而文未完'), false);
  assert.equal(alignSentenceGroups('〈一注。二注。〉', '〈第一注。第二注。〉')[0].kind, 'paragraph');
  for (const [paragraphId, before, after] of [
    ['old-v077-p9', '鄆齊', '等州觀察處置等使'],
    ['huiyao-v030-p29', '有高麗别種大舍利乞乞仲象', '與靺鞨反人乞四比羽'],
    ['old-v080-p6', '大破之，〈', '生擒衙內都指揮使安宏義'],
  ]) {
    const paragraph = originals.get(paragraphId);
    const sentence = splitSentenceSpans(paragraph.original).find(span => span.text.includes(before));
    assert.ok(sentence.text.includes(after), paragraphId);
    const group = findAlignmentGroup(alignments.get(paragraphId), sentence.start);
    assert.ok(sliceCodePoints(paragraph.original, group.originalStart, group.originalEnd).includes(after), paragraphId);
  }
});

test('poem repetition followed by shared explanation and unanchored translation tails remain whole paragraphs', () => {
  const poem = alignments.get('shibu-v001-p42');
  assert.equal(poem.groups.length, 1);
  assert.equal(poem.groups[0].kind, 'paragraph');
  assert.equal(sliceCodePoints(translations.get(poem.paragraphId).text, poem.groups[0].translationStart, poem.groups[0].translationEnd), translations.get(poem.paragraphId).text);
  const original = '甲午，某城发生蝗灾。乙未，节度使郭威加同平章事。';
  const explained = alignSentenceGroups(original, '甲午，某城发生蝗灾。乙未，节度使郭威加同平章事。意思是：这些事情共同反映当时局势。');
  assert.equal(explained[0].kind, 'paragraph');
  const unknownTail = alignSentenceGroups(original, '甲午，某城发生蝗灾。乙未，节度使郭威加同平章事。另外，这一切说明局势仍然动荡。');
  assert.equal(unknownTail[0].kind, 'paragraph');
});

test('short unique phrases veto misleading long-anchor boundaries in short and long paragraphs', () => {
  for (const extra of ['', '史事叙述'.repeat(150)]) {
    const original = `甲午东京发生蝗灾${extra}，令还俗。乙未皇帝临幸河中府。`;
    const translation = `甲午东京发生蝗灾${extra}。依命令还俗，乙未皇帝临幸河中府。`;
    const groups = alignSentenceGroups(original, translation);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].kind, 'paragraph');
  }
  for (const paragraphId of ['old-v115-p12', 'tongjian-v269-p70', 'old-v101-p1', 'huiyao-v022-p14']) {
    assert.equal(alignments.get(paragraphId).groups.length, 1, paragraphId);
    assert.equal(alignments.get(paragraphId).groups[0].kind, 'paragraph', paragraphId);
  }
  const movedShortName = alignSentenceGroups('郭威说，甲午东京发生蝗灾。乙未皇帝临幸河中府。', '甲午东京发生蝗灾。郭威随后说，乙未皇帝临幸河中府。');
  assert.equal(movedShortName[0].kind, 'paragraph');
  const missingSourceTail = alignSentenceGroups('甲午东京发生蝗灾，众人因此非常害怕。乙未皇帝临幸河中府。', '甲午东京发生蝗灾。大家特别恐惧，乙未皇帝临幸河中府。');
  assert.equal(missingSourceTail[0].kind, 'paragraph');
});

test('all 7,229 original/translation records have reproducible bound ranges with no copied text', () => {
  assert.equal(documents.length, 157);
  assert.equal(alignments.size, 7229);
  for (const document of documents) {
    assert.equal(readFileSync(new URL(`chapters/${document.chapterId}.json`, sentenceAlignmentsRoot), 'utf8'), `${JSON.stringify(document)}\n`);
    assert.deepEqual(validateSentenceAlignmentDocument(document), document);
    for (const alignment of document.paragraphs) {
      const paragraph = originals.get(alignment.paragraphId);
      const translation = translations.get(alignment.paragraphId);
      assert.equal(alignment.originalSha256, sha256(paragraph.original));
      assert.equal(alignment.originalRevision, paragraph.revision);
      assert.equal(alignment.translationId, translation.id);
      assert.equal(alignment.translationVersion, translation.version);
      assert.equal(alignment.translationSha256, sha256(translation.text));
      assert.equal(alignment.groups.map(group => sliceCodePoints(paragraph.original, group.originalStart, group.originalEnd)).join(''), paragraph.original);
      assert.equal(alignment.groups.map(group => sliceCodePoints(translation.text, group.translationStart, group.translationEnd)).join(''), translation.text);
      assert.equal('original' in alignment, false);
      assert.equal('text' in alignment, false);
    }
  }
});

test('checked real examples preserve internal split/merge meanings even when total sentence counts match', () => {
  const paragraph = originals.get('old-v101-p7');
  const translation = translations.get(paragraph.id);
  const alignment = alignments.get(paragraph.id);
  assert.equal(splitSentenceSpans(paragraph.original).length, splitSentenceSpans(translation.text).length);
  const guoWei = splitSentenceSpans(paragraph.original).find(span => span.text.includes('樞密使郭威'));
  const group = findAlignmentGroup(alignment, guoWei.start);
  assert.equal(sliceCodePoints(translation.text, group.translationStart, group.translationEnd), '庚申，枢密使郭威加同平章事。');
  assert.equal(sliceCodePoints(translation.text, alignment.groups[1].translationStart, alignment.groups[1].translationEnd), '当时法律崇尚严酷，藩镇州郡凡奏请处死，不核实真相，便依其请。因此当时幕僚很少受到宾客之礼，战战兢兢、小心侍奉，仍难免祸。');
  assert.equal(alignment.groups.at(-1).kind, 'group');
});

test('checked biography and chronological examples support genuine 2-to-1 and 1-to-2 ranges', () => {
  const cunXiao = alignments.get('new-v36-p19');
  assert.deepEqual(cunXiao.groups.map(group => group.kind), ['group', 'sentence']);
  assert.equal(sliceCodePoints(translations.get('new-v36-p19').text, cunXiao.groups[0].translationStart, cunXiao.groups[0].translationEnd), '李存孝是代州飞狐人，本姓安，名敬思。');
  const quewen = alignments.get('quewen-v001-p17');
  assert.equal(splitSentenceSpans(sliceCodePoints(translations.get('quewen-v001-p17').text, quewen.groups[1].translationStart, quewen.groups[1].translationEnd)).length, 2);
  assert.equal(alignments.get('tongjian-v279-p82').groups[0].kind, 'group');
  assert.equal(alignments.get('new-v03-p30').groups[0].kind, 'sentence');
  assert.equal(alignments.get('new-v25-p45').groups[0].kind, 'group');
  assert.equal(alignments.get('new-v06-p2').groups.length, 3);
  assert.equal(splitSentenceSpans(sliceCodePoints(translations.get('new-v06-p2').text, alignments.get('new-v06-p2').groups[2].translationStart, alignments.get('new-v06-p2').groups[2].translationEnd)).length, 2);
  assert.equal(alignments.get('new-v36-p17').groups.length, 11);
  assert.equal(splitSentenceSpans(sliceCodePoints(translations.get('new-v36-p17').text, alignments.get('new-v36-p17').groups[3].translationStart, alignments.get('new-v36-p17').groups[3].translationEnd)).length, 2);
});

test('runtime checks accept every current binding and reject changed original/translation IDs, versions or hashes', async () => {
  for (const document of documents) {
    const matches = await Promise.all(document.paragraphs.map(alignment => matchesSentenceAlignment(alignment, { ...originals.get(alignment.paragraphId), translation: translations.get(alignment.paragraphId) })));
    assert.ok(matches.every(Boolean), document.chapterId);
  }
  const paragraph = { ...originals.get('new-v36-p19'), translation: translations.get('new-v36-p19') };
  const alignment = alignments.get(paragraph.id);
  assert.equal(await matchesSentenceAlignment(alignment, { ...paragraph, revision: 2 }), false);
  assert.equal(await matchesSentenceAlignment(alignment, { ...paragraph, original: `${paragraph.original}改` }), false);
  assert.equal(await matchesSentenceAlignment(alignment, { ...paragraph, translation: { ...paragraph.translation, id: '99999' } }), false);
  assert.equal(await matchesSentenceAlignment(alignment, { ...paragraph, translation: { ...paragraph.translation, version: 2 } }), false);
  assert.equal(await matchesSentenceAlignment(alignment, { ...paragraph, translation: { ...paragraph.translation, text: `${paragraph.translation.text}改` } }), false);
  assert.equal(await matchesSentenceAlignment(alignment, { ...paragraph, translation: null }), false);
});

test('schema rejects duplicate/misleading paragraph identities, malformed hashes, empty and noncontiguous ranges', () => {
  const valid = documents.find(document => document.chapterId === 'new-v36');
  assert.equal(findSentenceAlignment(valid, 'new-v36-p19').paragraphId, 'new-v36-p19');
  assert.equal(findSentenceAlignment(valid, 'missing'), undefined);
  const mutate = change => { const copy = structuredClone(valid); change(copy); return copy; };
  assert.throws(() => validateSentenceAlignmentDocument(mutate(copy => copy.paragraphs.push(copy.paragraphs[0]))));
  assert.throws(() => validateSentenceAlignmentDocument(mutate(copy => { copy.paragraphs[0].paragraphId = 'new-v36-extra-p1'; })));
  assert.throws(() => validateSentenceAlignmentDocument(mutate(copy => { copy.paragraphs[0].translationSha256 = 'abc'; })));
  assert.throws(() => validateSentenceAlignmentDocument(mutate(copy => { copy.paragraphs[0].groups = []; })));
  assert.throws(() => validateSentenceAlignmentDocument(mutate(copy => { copy.paragraphs[0].groups[0].originalStart = 1; })));
  assert.throws(() => validateSentenceAlignmentDocument(mutate(copy => { copy.paragraphs[0].groups[0].translationEnd = 0; })));
  assert.throws(() => validateSentenceAlignmentDocument(mutate(copy => { copy.paragraphs[0].groups[0].kind = 'exact-guessed'; })));
});

test('a paragraph-range override cannot bypass bound hashes or sentence boundary checks', async () => {
  const paragraph = { ...originals.get('new-v36-p19'), translation: translations.get('new-v36-p19') };
  const invalid = structuredClone(alignments.get(paragraph.id));
  invalid.groups[0].kind = 'sentence';
  assert.equal(await matchesSentenceAlignment(invalid, paragraph), false);
  const outside = structuredClone(alignments.get(paragraph.id));
  outside.groups.at(-1).translationEnd += 1;
  assert.equal(await matchesSentenceAlignment(outside, paragraph), false);
  const changedLibrary = structuredClone(library);
  changedLibrary.chapters[0].paragraphs[0].original += '改';
  assert.throws(() => buildSentenceAlignmentDocuments(changedLibrary), /binding/);
});
