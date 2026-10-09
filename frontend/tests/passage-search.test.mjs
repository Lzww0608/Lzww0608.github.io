import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ConverterBuilder } from 'opencc-js/core';
import * as Locale from 'opencc-js/preset/t2cn';
import { createTextSearch, createSearchConverter, validateSearchQuery } from '../../content/passage-search.mts';
import { loadPassageSearch } from '../src/passage-search.ts';

const search = createTextSearch(createSearchConverter(ConverterBuilder, Locale));
const excerpts = (text, ranges) => ranges.map(({ start, end }) => [...text].slice(start, end).join(''));

test('real archived original and published translation can be searched with either Chinese script', () => {
  const chapter = JSON.parse(readFileSync(new URL('../../content/five-dynasties/chapters/new-v06.json', import.meta.url), 'utf8'));
  const published = JSON.parse(readFileSync(new URL('../../content/published-translations/new.json', import.meta.url), 'utf8'));
  const source = chapter.paragraphs.find(paragraph => paragraph.id === 'new-v06-p16');
  const translation = published.entries.find(entry => entry.paragraphId === source.id).translation;
  const paragraph = { ...source, translation };
  for (const query of ['達靼', '达靼']) {
    const match = search.matchParagraph(paragraph, query, 'both');
    assert.ok(match);
    assert.ok(match.original.length > 0 && match.translation.length > 0);
    assert.ok(excerpts(source.original, match.original).every(text => search.normalize(text) === '达靼'));
    assert.ok(excerpts(translation.text, match.translation).every(text => search.normalize(text) === '达靼'));
  }
  assert.deepEqual(search.matchParagraph(paragraph, '達靼', 'both'), search.matchParagraph(paragraph, '达靼', 'both'));
});

test('historical character variants, merged 發／髮 and preserved reader-era names share search equivalence', () => {
  const guards = '侍衞、衛士。';
  for (const query of ['衞', '衛', '卫']) assert.deepEqual(search.findRanges(guards, query), [{ start: 1, end: 2 }, { start: 3, end: 4 }]);
  const dispatch = '發兵，頭髮白。';
  for (const query of ['發', '髮', '发']) assert.deepEqual(search.findRanges(dispatch, query), [{ start: 0, end: 1 }, { start: 4, end: 5 }]);
  const era = '乾化元年，干化二年。';
  for (const query of ['乾化', '干化']) assert.deepEqual(search.findRanges(era, query), [{ start: 0, end: 2 }, { start: 5, end: 7 }]);
  // Phrase conversion must see its context: converting 乾 alone produces 干,
  // whereas the real OpenCC phrase 乾坤 remains 乾坤.
  assert.equal(search.normalize('乾坤，乾燥。'), '乾坤,干燥。');
  assert.deepEqual(search.findRanges('天地乾坤，乾燥。', '乾坤'), [{ start: 2, end: 4 }]);
  assert.deepEqual(search.findRanges('天地乾坤，乾燥。', '干燥'), [{ start: 5, end: 7 }]);
});

test('exact written characters remain searchable when phrase context overrides single-character normalization', () => {
  assert.deepEqual(search.findRanges('天地乾坤。', '乾'), [{ start: 2, end: 3 }]);
  assert.deepEqual(search.findRanges('天地乾坤。', '干'), []);
  assert.equal(search.normalize('天地乾坤。'), '天地乾坤。');
  assert.deepEqual(search.findRanges('著作，藉藉。', '著'), [{ start: 0, end: 1 }]);
  assert.deepEqual(search.findRanges('著作，藉藉。', '藉'), [{ start: 3, end: 5 }]);
  assert.deepEqual(search.findRanges('憑藉史料，不取藉口。', '藉'), [{ start: 1, end: 2 }, { start: 7, end: 8 }]);
  assert.deepEqual(search.findRanges('憑藉史料，不取藉口。', '借口'), [{ start: 7, end: 9 }]);
  assert.deepEqual(search.findRanges('潞州与晉陽。', '晋阳'), [{ start: 3, end: 5 }]);
  // Exact and normalized paths can find the same range; it must appear once.
  assert.deepEqual(search.findRanges('發兵于潞州。', '潞州'), [{ start: 3, end: 5 }]);
});

test('original, translation and combined fields report only the requested visible body matches', () => {
  const paragraph = { id: 'p1', original: '朱溫率兵，攻潞州。', translation: { text: '朱温统率军队，进攻潞州。' } };
  assert.equal(search.matchParagraph(paragraph, '軍隊', 'original'), null);
  const translationOnly = search.matchParagraph(paragraph, '軍隊', 'translation');
  assert.deepEqual(translationOnly.original, []);
  assert.deepEqual(excerpts(paragraph.translation.text, translationOnly.translation), ['军队']);
  const originalOnly = search.matchParagraph(paragraph, '率兵', 'original');
  assert.deepEqual(excerpts(paragraph.original, originalOnly.original), ['率兵']);
  assert.deepEqual(originalOnly.translation, []);
  const both = search.matchParagraph(paragraph, '潞州', 'both');
  assert.deepEqual(excerpts(paragraph.original, both.original), ['潞州']);
  assert.deepEqual(excerpts(paragraph.translation.text, both.translation), ['潞州']);
  assert.equal(search.matchParagraph(paragraph, '不存在的记载', 'both'), null);
  assert.throws(() => search.matchParagraph(paragraph, '潞州', 'notes'), TypeError);
});

test('search does not treat unexposed drafts, credits, review notes or passage metadata as content', () => {
  const paragraph = {
    id: 'p1', original: '原文正文。', translation: { text: '公开译文。', translator: '署名关键词', reviewNotes: ['校核提示关键词'] },
    draftTranslations: [{ status: 'draft', text: '私有草稿关键词' }],
  };
  const passage = { id: 'record-1', title: '标题关键词', sourceUrl: 'https://example.test/来源关键词', paragraphs: [paragraph] };
  for (const query of ['私有草稿关键词', '署名关键词', '校核提示关键词', '标题关键词', '来源关键词']) {
    assert.deepEqual(search.filterPassages([passage], query, 'both'), []);
  }
  const noPublishedTranslation = { id: 'p2', original: '此段只有原文。', translation: null, draftTranslations: [{ text: '秘密译文' }] };
  assert.equal(search.matchParagraph(noPublishedTranslation, '秘密', 'translation'), null);
  assert.equal(search.matchParagraph(noPublishedTranslation, '原文', 'translation'), null);
  assert.ok(search.matchParagraph(noPublishedTranslation, '原文', 'original'));
});

test('highlight ranges use full Unicode code points after compatibility expansion and case folding', () => {
  const text = '😀𠀀甲𨭉㍿乙ﬃＦＯＯİ';
  assert.deepEqual(search.findRanges(text, '𠀀甲𨭉'), [{ start: 1, end: 4 }]);
  assert.deepEqual(search.findRanges(text, '株式会社'), [{ start: 4, end: 5 }]);
  assert.deepEqual(search.findRanges(text, '式会社'), [{ start: 4, end: 5 }]);
  assert.deepEqual(search.findRanges(text, 'FFI'), [{ start: 6, end: 7 }]);
  assert.deepEqual(search.findRanges(text, 'foo'), [{ start: 7, end: 10 }]);
  assert.deepEqual(search.findRanges(text, 'i\u0307'), [{ start: 10, end: 11 }]);
  assert.deepEqual(excerpts(text, search.findRanges(text, '株式会社')), ['㍿']);
});

test('contextual contraction and expansion highlight the whole canonical phrase without guessed ratios', () => {
  const contracted = createTextSearch(text => text.replaceAll('甲乙', '丙'));
  assert.deepEqual(contracted.findRanges('𠀀前甲乙後𨭉', '丙'), [{ start: 2, end: 4 }]);
  assert.deepEqual(contracted.findRanges('𠀀前甲乙後𨭉', '甲乙'), [{ start: 2, end: 4 }]);
  const expanded = createTextSearch(text => text.replaceAll('甲乙', '丙丁戊'));
  for (const query of ['丙', '丁', '戊', '丙丁戊']) assert.deepEqual(expanded.findRanges('前甲乙後', query), [{ start: 1, end: 3 }]);
  const removed = createTextSearch(text => text.replaceAll('乙', ''));
  assert.deepEqual(removed.findRanges('前甲乙丙後', '甲丙'), [{ start: 1, end: 4 }]);
});

test('overlapping and adjacent matches merge while separated occurrences retain separate highlight ranges', () => {
  const literal = createTextSearch(text => text);
  assert.deepEqual(literal.findRanges('aaaa', 'aa'), [{ start: 0, end: 4 }]);
  assert.deepEqual(search.findRanges('潞州潞州，潞州。', '潞州'), [{ start: 0, end: 4 }, { start: 5, end: 7 }]);
  assert.deepEqual(search.findRanges('前潞州，後潞州。', '潞州'), [{ start: 1, end: 3 }, { start: 5, end: 7 }]);
});

test('regular-expression, HTML and SQL-looking input is matched as literal text', () => {
  const text = '前.*+?^${}()|[]\\，<img src=x>，\' OR 1=1 --，100%_。後';
  for (const query of ['.*+?^${}()|[]\\', '<img src=x>', "' OR 1=1 --", '%_']) {
    const ranges = search.findRanges(text, query);
    assert.equal(ranges.length, 1);
    assert.deepEqual(excerpts(text, ranges), [query]);
  }
  assert.deepEqual(search.findRanges('普通正文。', '.*'), []);
});

test('the query limit is 100 Unicode code points and rejects raw control characters', () => {
  const maximum = '𠀀'.repeat(100);
  assert.equal(maximum.length, 200);
  assert.equal(validateSearchQuery(maximum), maximum);
  assert.deepEqual(search.findRanges(`前${maximum}後`, maximum), [{ start: 1, end: 101 }]);
  assert.throws(() => validateSearchQuery('𠀀'.repeat(101)), TypeError);
  assert.equal(validateSearchQuery('  潞州  '), '潞州');
  assert.equal(validateSearchQuery('   '), '');
  assert.deepEqual(search.findRanges('潞州。', '   '), []);
  for (const query of ['\n潞州', '潞州\t', '潞\u0000州', '\u001f', '\u007f']) {
    assert.throws(() => validateSearchQuery(query), TypeError);
    assert.throws(() => search.findRanges('潞州。', query), TypeError);
  }
});

test('filtering and repeated highlights preserve canonical text and all published metadata', () => {
  const translation = Object.freeze({ id: '42', version: 3, text: '潞州的军队。', translator: '所有者', reviewNotes: Object.freeze(['保存原说明']) });
  const paragraph = Object.freeze({ id: 'p1', position: 7, revision: 2, original: '潞州之兵。', translation });
  const item = Object.freeze({ id: 'record-1', paragraphs: Object.freeze([paragraph]), sourceUrl: 'https://example.test/source' });
  const before = JSON.stringify(item);
  const result = search.filterPassages([item], '潞州', 'both');
  assert.equal(result.length, 1);
  assert.equal(result[0].paragraphs, item.paragraphs);
  assert.equal(result[0].paragraphs[0].translation, translation);
  assert.equal(JSON.stringify(item), before);
  result[0].searchMatches[0].original[0].start = 99;
  assert.deepEqual(search.findRanges(paragraph.original, '潞州'), [{ start: 0, end: 2 }]);
  assert.equal(JSON.stringify(item), before);
});

test('the browser adapter lazily reuses the same converter and reports missing conversion data clearly', async () => {
  const [first, second] = await Promise.all([loadPassageSearch(), loadPassageSearch()]);
  assert.equal(first, second);
  assert.equal(first.normalize('侍衞、頭髮、乾化'), search.normalize('侍衞、頭髮、乾化'));
  assert.throws(() => createSearchConverter(ConverterBuilder, {}), /Missing search conversion dictionary/);
});
