import assert from 'node:assert/strict';
import test from 'node:test';
import { chapterRoute, libraryChapters, personSourcesRoute, resolvePersonSourcesRoute, resolveReadingRoute, resolveRoute } from '../src/library.ts';
import { highlightSegments, searchHighlightRanges } from '../src/search-highlight.ts';
import { loadPassageSearch } from '../src/passage-search.ts';
import { loadOriginalConverter } from '../src/original-script.ts';
import { readingFocusKey } from '../src/reading-focus.ts';

test('person search routes preserve query, field and book, including legacy routes', () => {
  const route = personSourcesRoute('li-cunxu', 'tongjian', { query: ' 潞州 & 晉陽 ', field: 'translation' });
  const resolved = resolvePersonSourcesRoute(route);
  assert.equal(resolved.person.id, 'li-cunxu');
  assert.equal(resolved.book.id, 'tongjian');
  assert.deepEqual(resolved.search, { query: '潞州 & 晉陽', field: 'translation' });
  assert.equal(resolveRoute(`#${route}`), route);
  assert.deepEqual(resolvePersonSourcesRoute('person-sources/li-cunxu').search, { query: '', field: 'both' });
  assert.deepEqual(resolvePersonSourcesRoute('person-sources/li-cunxu/new?q=%E6%99%89%E9%98%B3').search, { query: '晉阳', field: 'both' });
  assert.equal(resolvePersonSourcesRoute(`person-sources/li-cunxu?q=${'人'.repeat(101)}`), null);
  assert.equal(resolvePersonSourcesRoute('person-sources/li-cunxu?q=%09%E6%BD%9E%E5%B7%9E'), null);
});

test('context route survives refresh with exact paragraph and safe return to the same search', () => {
  const chapter = libraryChapters.find(item => item.id === 'tongjian-v266');
  const query = '潞州';
  const returnTo = personSourcesRoute('li-cunxu', 'tongjian', { query, field: 'original' });
  const context = chapterRoute(chapter, { query, field: 'original', paragraphId: 'tongjian-v266-p10', returnTo });
  const resolved = resolveReadingRoute(context);
  assert.equal(resolved.focusParagraphId, 'tongjian-v266-p10');
  assert.equal(resolved.returnTo, returnTo);
  assert.deepEqual(resolved.search, { query, field: 'original' });
  for (const unsafe of ['https://evil.example/', 'javascript:alert(1)', 'person-sources/missing/new', 'people']) {
    assert.equal(resolveReadingRoute(`read-tongjian/tongjian-v266?return=${encodeURIComponent(unsafe)}`).returnTo, undefined);
  }
  assert.equal(resolveReadingRoute('read-tongjian/tongjian-v266?paragraph=old-v001-p1').focusParagraphId, undefined);
});

test('highlight intersections preserve every character and Unicode offsets inside sentence triggers', () => {
  const original = '𠀀潞州。晋阳<字>'; // The first character occupies two UTF-16 code units.
  const ranges = [{ start: 1, end: 3 }, { start: 4, end: 6 }];
  const complete = highlightSegments(original, ranges);
  assert.equal(complete.map(segment => segment.text).join(''), original);
  assert.deepEqual(complete.filter(segment => segment.matched).map(segment => segment.text), ['潞州', '晋阳']);
  const firstSentence = highlightSegments('𠀀潞州。', ranges, 0);
  const secondSentence = highlightSegments('晋阳<字>', ranges, 4);
  assert.equal([...firstSentence, ...secondSentence].map(segment => segment.text).join(''), original);
  assert.deepEqual(secondSentence.filter(segment => segment.matched).map(segment => segment.text), ['晋阳']);
  assert.deepEqual(highlightSegments('潞州。晋阳', [{ start: 1, end: 5 }], 0).filter(segment => segment.matched).map(segment => segment.text), ['州。晋阳']);
});

test('a canonical match stays highlighted when phrase conversion changes the displayed character', async () => {
  const engine = await loadPassageSearch();
  const convert = await loadOriginalConverter();
  const canonical = '𠀀憑藉戰功。';
  const displayed = convert(canonical);
  assert.equal(displayed, '𠀀凭借战功。');
  assert.deepEqual(engine.findRanges(displayed, '藉'), []);
  const ranges = searchHighlightRanges(engine, displayed, '藉', canonical, convert);
  assert.deepEqual(ranges, [{ start: 2, end: 3 }]);
  assert.deepEqual(highlightSegments(displayed, ranges).filter(segment => segment.matched).map(segment => segment.text), ['借']);
  assert.equal(highlightSegments(displayed, ranges).map(segment => segment.text).join(''), displayed);
  const expandedConverter = text => text.replaceAll('憑', '凭').replaceAll('藉', '借用').replaceAll('戰', '战');
  const expandedDisplay = expandedConverter(canonical);
  const expandedRanges = searchHighlightRanges(engine, expandedDisplay, '藉', canonical, expandedConverter);
  assert.deepEqual(expandedRanges, [{ start: 2, end: 4 }]);
  assert.deepEqual(highlightSegments(expandedDisplay, expandedRanges).filter(segment => segment.matched).map(segment => segment.text), ['借用']);
  assert.equal(highlightSegments(expandedDisplay, expandedRanges).map(segment => segment.text).join(''), expandedDisplay);
  // An unrelated display must never inherit source offsets.
  assert.deepEqual(searchHighlightRanges(engine, '另一段原文', '藉', canonical, convert), []);
});

test('context positioning recognizes newer API originals and published translations after an archive preview', () => {
  const paragraph = { id: 'new-v01-p1', revision: 1, original: '潞州記事。', translation: { id: '100', version: 1, text: '潞州的记事。' } };
  const key = value => readingFocusKey('new-v01', value, '潞州', 'both', 'traditional');
  const archiveKey = key(paragraph);
  assert.equal(archiveKey, key({ ...paragraph }));
  assert.notEqual(archiveKey, key({ ...paragraph, revision: 2, original: '前事。潞州記事。' }));
  assert.notEqual(archiveKey, key({ ...paragraph, translation: { ...paragraph.translation, id: '101', version: 2, text: '前面的史事。潞州的记事。' } }));
  assert.notEqual(archiveKey, key({ ...paragraph, translation: { ...paragraph.translation, text: '新增的前文。潞州的记事。' } }));
});
