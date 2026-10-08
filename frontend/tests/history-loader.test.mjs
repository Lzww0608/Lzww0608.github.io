import test from 'node:test';
import assert from 'node:assert/strict';
import { readChapter } from '../src/history-loader.ts';
import { resolveRoute, resolveReadingRoute, chaptersForPerson, chapterRoute } from '../src/library.ts';
import { loadLibrary } from '../../content/library.mjs';
import { loadPublishedChapters } from '../../content/translations.mjs';
const { catalog, chapters } = loadLibrary();
const archived = chapters.find(chapter => chapter.id === 'old-v110');
const response = value => new Response(JSON.stringify(value), { status: 200 });
const options = () => ({ bookId: 'old', chapterId: archived.id, apiBase: 'https://api.example', archiveBase: '/', signal: new AbortController().signal });

test('internal links open the requested founder and book, and reject cross-book or unknown IDs', () => {
  assert.equal(resolveReadingRoute('read-old').chapter.id, 'old-v001');
  assert.equal(resolveReadingRoute('read-tongjian').chapter.id, 'tongjian-v266');
  for (const chapter of chaptersForPerson('guo-wei')) assert.equal(resolveReadingRoute(chapterRoute(chapter)).chapter.id, chapter.id);
  assert.equal(resolveRoute('#read-new/old-v110'), 'overview');
  assert.equal(resolveRoute('#read-old/not-real'), 'overview');
  assert.equal(resolveReadingRoute('read-old/../../private'), null);
});

test('a stopped API still opens all archived paragraphs without an external source link', async () => {
  const urls = [];
  const result = await readChapter({ ...options(), fetcher: async url => { urls.push(url); if (url.startsWith('https:')) throw new Error('Mac offline'); return response(archived); } });
  assert.equal(result.source, 'archive');
  assert.deepEqual(result.chapter.paragraphs, archived.paragraphs);
  assert.deepEqual(urls.sort(), ['/history/chapters/old-v110.json', 'https://api.example/api/chapters/old-v110'].sort());
});

test('the archive is rendered while the API is pending, then published translations take priority', async () => {
  let finishApi;
  let opened;
  const pending = new Promise(resolve => { finishApi = resolve; });
  const loaded = readChapter({ ...options(), fetcher: url => url.startsWith('https:') ? pending : Promise.resolve(response(archived)), onArchive: chapter => { opened = chapter; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(opened.id, archived.id);
  const live = structuredClone(archived);
  live.paragraphs[0].translation = { id: '42', language: 'zh-Hans', version: 1, translator: '校核译者', text: '已发布译文' };
  finishApi(response(live));
  const result = await loaded;
  assert.equal(result.source, 'api');
  assert.equal(result.chapter.paragraphs[0].translation.text, '已发布译文');
});

test('wrong-chapter API responses cannot replace the requested local chapter', async () => {
  const other = chapters.find(chapter => chapter.id === 'old-v001');
  const result = await readChapter({ ...options(), fetcher: async url => response(url.startsWith('https:') ? other : archived) });
  assert.equal(result.source, 'archive'); assert.equal(result.chapter.id, 'old-v110');
});

test('aborted navigation does not publish stale content', async () => {
  const controller = new AbortController(); controller.abort();
  let updates = 0;
  await assert.rejects(readChapter({ ...options(), signal: controller.signal, onArchive: () => updates++, fetcher: async () => response(archived) }), error => error.name === 'AbortError');
  assert.equal(updates, 0);
});


test('every book opens its default volume and every archived chapter works with the API offline', async () => {
  for (const book of catalog.books) assert.equal(resolveReadingRoute(`read-${book.id}`).chapter.id, book.defaultChapter);
  for (const chapter of chapters) {
    assert.equal(resolveReadingRoute(`read-${chapter.bookId}/${chapter.id}`).chapter.id, chapter.id);
    const result = await readChapter({ ...options(), bookId:chapter.bookId, chapterId:chapter.id, fetcher:async url => { if (url.startsWith('https:')) throw new Error('offline'); return response(chapter); } });
    assert.equal(result.source, 'archive');
    assert.deepEqual(result.chapter, chapter);
  }
});

test('all 7229 published translations remain readable from static chapters when the API is offline', async () => {
  const originalLibrary = loadLibrary();
  const publishedChapters = loadPublishedChapters(originalLibrary);
  let translated = 0;
  for (const chapter of publishedChapters.filter(chapter => chapter.paragraphs.some(paragraph => paragraph.translation))) {
    const original = originalLibrary.chapters.find(item => item.id === chapter.id);
    const result = await readChapter({ ...options(), bookId: chapter.bookId, chapterId: chapter.id,
      fetcher: async url => { if (url.startsWith('https:')) throw new Error('offline'); return response(chapter); } });
    assert.equal(result.source, 'archive');
    assert.deepEqual(result.chapter, chapter);
    for (const [index, paragraph] of result.chapter.paragraphs.entries()) {
      assert.equal(paragraph.original, original.paragraphs[index].original);
      assert.equal(original.paragraphs[index].translation, null);
      if (!paragraph.translation) continue;
      translated++;
      assert.equal(paragraph.translation.origin, 'ai');
      assert.equal(paragraph.translation.reviewStatus, 'pending');
      assert.equal(paragraph.translation.version, 1);
    }
  }
  assert.equal(translated, 7229);
});
