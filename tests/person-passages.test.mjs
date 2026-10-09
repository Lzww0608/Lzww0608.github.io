import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadLibrary } from '../content/library.mjs';
import { buildPersonPassageSummary, loadPassagePeople, loadPersonPassageIndex, validatePersonPassageIndex } from '../content/person-passages.mjs';
import { buildPersonPassageIndex, inferRegnalEdictPeople, validateChronologySubjects } from '../scripts/index-person-passages.mjs';

const library = loadLibrary();
const index = loadPersonPassageIndex(library);
const byParagraph = new Map(index.passages.map(passage => [passage.spans[0].paragraphId, passage]));
const association = (paragraphId, personId) => byParagraph.get(paragraphId)?.people.find(person => person.personId === personId);
const paragraphs = new Map(library.chapters.flatMap(chapter => chapter.paragraphs.map(paragraph => [paragraph.id, paragraph])));
const rules = JSON.parse(readFileSync(new URL('../content/person-passages/rules.json', import.meta.url), 'utf8'));

test('generation scans the whole canonical archive and reproduces the saved shared index', () => {
  assert.deepEqual(buildPersonPassageIndex(library), index);
  assert.deepEqual(index.people, loadPassagePeople());
  assert.deepEqual(index.coverage, { bookCount: library.catalog.books.length, chapterCount: library.chapters.length,
    paragraphCount: library.chapters.reduce((sum, chapter) => sum + chapter.paragraphs.length, 0) });
  assert.equal(index.scope, 'current-archive');
  const bookByChapter = new Map(library.chapters.map(chapter => [chapter.id, chapter.bookId]));
  assert.equal(new Set(index.passages.map(passage => bookByChapter.get(passage.chapterId))).size, library.catalog.books.length);
  for (const person of index.people) {
    assert.ok(index.passages.some(passage => passage.chapterId.startsWith('old-')
      && passage.people.some(item => item.personId === person.id && item.kind === 'biography')), `old biography: ${person.id}`);
    assert.ok(index.passages.some(passage => passage.chapterId.startsWith('new-')
      && passage.people.some(item => item.personId === person.id && item.kind === 'biography')), `new biography: ${person.id}`);
  }
});

test('cross-biography records are found even outside catalog chapter subjects', () => {
  assert.equal(association('new-v06-p2', 'li-siyuan')?.kind, 'biography');
  assert.equal(association('new-v06-p2', 'li-cunxin')?.kind, 'record');
  assert.equal(association('new-v06-p3', 'li-sizhao')?.kind, 'record');
  assert.equal(byParagraph.get('new-v06-p2').id, 'passage-new-v06-p2');
  assert.equal(index.passages.filter(passage => passage.spans.some(span => span.paragraphId === 'new-v06-p2')).length, 1);
  assert.equal(association('tongjian-v282-p96', 'shi-jingtang')?.kind, 'record');
  assert.equal(association('tongjian-v282-p96', 'liu-zhiyuan')?.kind, 'record');
  assert.ok(rules.titleExclusions.some(item => item.paragraphId === 'tongjian-v266-p8'
    && item.personId === 'zhu-wen' && item.terms.includes('帝')), 'Tang Zhaoxuan emperor is not inferred as Zhu Wen');
});

test('combined biographies stop at actual new subjects and attached fathers have exact ranges', () => {
  assert.equal(association('new-v36-p22', 'li-cunxiao')?.kind, 'biography');
  assert.equal(association('new-v36-p23', 'kang-junli')?.kind, 'biography');
  assert.notEqual(association('new-v36-p23', 'li-cunxiao')?.kind, 'biography');
  assert.equal(association('new-v36-p24', 'li-cunjin')?.kind, 'biography');
  assert.equal(association('new-v36-p24', 'kang-junli'), undefined);
  assert.equal(association('new-v36-p24', 'li-cunxiao'), undefined);
  assert.equal(association('new-v36-p28', 'li-cunjin'), undefined);
  assert.equal(association('new-v25-p24', 'shi-jingsi')?.kind, 'biography');
  assert.equal(association('new-v25-p25', 'shi-jingsi'), undefined);
  assert.equal(association('old-v055-p5', 'shi-jingsi')?.kind, 'biography');
  assert.equal(association('old-v055-p6', 'shi-jingsi'), undefined);
  assert.equal(association('new-v25-p17', 'fu-cunshen'), undefined);
  assert.equal(association('old-v052-p20', 'li-sizhao'), undefined);
  assert.equal(association('new-v10-p8', 'liu-chengyou')?.kind, 'biography');
  assert.notEqual(association('new-v10-p8', 'liu-zhiyuan')?.kind, 'biography');
  assert.equal(association('new-v12-p9', 'chai-zongxun')?.kind, 'biography');
  assert.notEqual(association('new-v12-p9', 'chai-rong')?.kind, 'biography');
});

test('same short names do not absorb separately named contemporaries or literary aliases', () => {
  for (const [paragraphId, personId] of [
    ['tongjian-v267-p73', 'liu-zhiyuan'], ['old-v046-p20', 'liu-chengyou'], ['old-v046-p22', 'liu-chengyou'],
    ['tongjian-v269-p20', 'chai-zongxun'], ['tongjian-v269-p64', 'kang-junli'], ['tongjian-v271-p9', 'kang-junli'],
    ['tongjian-v275-p22', 'kang-junli'], ['old-v036-p2', 'kang-junli'], ['old-v036-p3', 'kang-junli'], ['old-v041-p18', 'kang-junli'],
    ['new-v36-p19', 'shi-jingsi'], ['old-v053-p5', 'shi-jingsi'], ['tongjian-v266-p77', 'li-cunxu'],
  ]) assert.equal(association(paragraphId, personId), undefined, `${paragraphId}: ${personId}`);
  assert.equal(association('tongjian-v294-p95', 'chai-zongxun')?.kind, 'record', 'King of Liang title is not a Wang surname');
  assert.equal(association('kaoyi-v030-p62', 'chai-zongxun')?.kind, 'record', 'the quoted King of Liang name remains a real mention');
  assert.equal(association('tongjian-v269-p20', 'chai-zongxun'), undefined, 'the Former Shu commander remains excluded');
  assert.equal(association('old-v043-p4', 'li-conghou')?.kind, 'record', 'Song King Conghou title stays readable');
  assert.equal(association('tongjian-v279-p6', 'li-congke')?.kind, 'record', 'Lu King Congke title stays readable');
});

test('ancient and foreign Gaozu / Song Taizu titles remain unassigned to the wrong people', () => {
  for (const paragraphId of ['tongjian-v283-p14', 'huiyao-v010-p64', 'old-v110-p20', 'huiyao-v008-p20']) {
    assert.equal(association(paragraphId, 'liu-zhiyuan'), undefined, paragraphId);
  }
  assert.equal(association('quewen-v001-p44', 'guo-wei'), undefined);
  assert.equal(association('tongjian-v294-p37', 'guo-wei'), undefined);
  assert.equal(association('tongjian-v294-p79', 'guo-wei'), undefined);
  assert.equal(association('old-v079-p12', 'li-congke'), undefined);
  assert.equal(association('huiyao-v018-p22', 'li-congke'), undefined);
  assert.equal(association('old-v079-p12', 'shi-jingtang')?.kind, 'biography', 'only the incorrect title association is removed');
  assert.ok(association('kaoyi-v030-p5', 'liu-zhiyuan'), 'attested 逺 variant');
});

test('Liao and Wuyue Shizong references do not become Chai Rong records', () => {
  for (const paragraphId of ['old-v103-p4', 'old-v103-p19', 'kaoyi-v029-p52']) {
    assert.equal(association(paragraphId, 'chai-rong'), undefined, paragraphId);
    assert.ok(rules.titleExclusions.some(item => item.paragraphId === paragraphId
      && item.personId === 'chai-rong' && item.terms.includes('世宗')));
  }
  assert.equal(association('old-v103-p4', 'liu-chengyou')?.kind, 'biography');
  assert.equal(association('old-v103-p4', 'guo-wei')?.kind, 'record');
  assert.equal(association('old-v113-p12', 'chai-rong')?.kind, 'record', 'Guo Wei succession advice names the real Later Zhou Shizong');
  assert.equal(association('new-v12-p9', 'chai-rong')?.kind, 'record', 'Chai Zongxun biography names his father Shizong');
  assert.equal(association('kaoyi-v030-p22', 'chai-rong')?.kind, 'mention', 'Later Zhou Shizong shilu title remains a real citation');
});

test('summary is derived from shared associations and real book/chapter identifiers', () => {
  const summary = buildPersonPassageSummary(index, library);
  assert.equal(summary.schemaVersion, 1);
  const chapterBooks = new Map(library.chapters.map(chapter => [chapter.id, chapter.bookId]));
  for (const person of summary.people) for (const book of person.books) {
    const matches = index.passages.filter(passage => chapterBooks.get(passage.chapterId) === book.bookId
      && passage.people.some(item => item.personId === person.id));
    assert.equal(book.passageCount, matches.length);
    assert.equal(book.chapterCount, new Set(matches.map(passage => passage.chapterId)).size);
  }
});

test('regnal attribution needs a dated imperial order and respects accession months', () => {
  for (const [paragraphId, personId] of [
    ['huiyao-v001-p55', 'zhu-wen'], ['huiyao-v005-p7', 'chai-rong'], ['huiyao-v006-p59', 'shi-jingtang'],
    ['huiyao-v011-p68', 'guo-wei'], ['huiyao-v012-p56', 'li-siyuan'], ['huiyao-v017-p62', 'shi-chonggui'],
    ['huiyao-v019-p33', 'guo-wei'], ['huiyao-v022-p37', 'zhu-wen'], ['huiyao-v024-p95', 'li-siyuan'],
    ['huiyao-v026-p35', 'guo-wei'], ['huiyao-v003-p7', 'chai-zongxun'], ['huiyao-v014-p40', 'liu-chengyou'],
  ]) {
    assert.ok(inferRegnalEdictPeople(paragraphs.get(paragraphId).original, 'huiyao', rules.regnalEdicts).includes(personId), paragraphId);
    assert.equal(association(paragraphId, personId)?.kind, 'record');
  }
  for (const paragraphId of ['huiyao-v003-p36', 'huiyao-v006-p53', 'huiyao-v011-p47', 'huiyao-v025-p10']) {
    assert.deepEqual(inferRegnalEdictPeople(paragraphs.get(paragraphId).original, 'huiyao', rules.regnalEdicts), [], paragraphId);
  }
  const infer = text => inferRegnalEdictPeople(text, 'huiyao', rules.regnalEdicts);
  assert.deepEqual(infer('長興縣民於天成二年蝗害，官員祭告；後來詔禁捕食此鳥。'), []);
  assert.deepEqual(infer('顯德元年正月敕：「諸司依舊。」'), []);
  assert.deepEqual(infer('顯德六年六月敕：「諸司依舊。」'), []);
  assert.deepEqual(infer('乾祐元年正月敕：「諸司依舊。」'), []);
  assert.deepEqual(infer('天福七年六月敕：「諸司依舊。」'), []);
  assert.deepEqual(infer('長興四年十一月敕：「諸司依舊。」'), []);
  assert.deepEqual(infer('天成二年七月敕：「依舊。」'), ['li-siyuan']);
  assert.deepEqual(inferRegnalEdictPeople('天成二年七月敕：「依舊。」', 'beimeng', rules.regnalEdicts), []);
});

test('reviewed chronology subjects bind actual paragraphs, people and full original hashes', () => {
  const subjects = JSON.parse(readFileSync(new URL('../content/person-passages/chronology-subjects.json', import.meta.url), 'utf8'));
  assert.equal(validateChronologySubjects(subjects, library), subjects);
  for (const entry of subjects.entries) assert.ok(association(entry.paragraphId, entry.personId), `${entry.paragraphId}: ${entry.personId}`);
  const invalid = change => {
    const copy = structuredClone(subjects); change(copy);
    assert.throws(() => validateChronologySubjects(copy, library), /Invalid passage rules/);
  };
  assert.ok(subjects.entries.length > 0, 'independently audited supplement is present');
  invalid(copy => copy.entries[0].expectedSha256 = '0'.repeat(64));
  invalid(copy => copy.entries[0].paragraphId = 'tongjian-v999-p1');
  invalid(copy => copy.entries[0].personId = 'unknown-person');
  invalid(copy => copy.entries[0].kind = 'biography');
  invalid(copy => copy.entries.push(copy.entries[0]));
});

test('twenty-four reviewed paragraphs beginning with 帝 retain their actual local sovereign', () => {
  for (const [paragraphId, personId] of [
    ['tongjian-v267-p14', 'zhu-wen'], ['tongjian-v269-p63', 'zhu-youzhen'], ['tongjian-v272-p45', 'li-cunxu'],
    ['tongjian-v275-p29', 'li-siyuan'], ['tongjian-v279-p105', 'li-congke'], ['tongjian-v280-p52', 'shi-jingtang'],
    ['tongjian-v283-p42', 'shi-chonggui'], ['tongjian-v290-p27', 'guo-wei'], ['tongjian-v292-p40', 'chai-rong'],
    ['tongjian-v267-p20', 'zhu-wen'], ['tongjian-v270-p19', 'zhu-youzhen'], ['tongjian-v273-p54', 'li-cunxu'],
    ['tongjian-v276-p99', 'li-siyuan'], ['tongjian-v281-p99', 'shi-jingtang'], ['tongjian-v283-p96', 'shi-chonggui'],
    ['tongjian-v291-p84', 'guo-wei'], ['tongjian-v292-p86', 'chai-rong'], ['tongjian-v268-p42', 'zhu-wen'],
    ['tongjian-v273-p100', 'li-cunxu'], ['tongjian-v278-p50', 'li-siyuan'], ['tongjian-v284-p8', 'shi-chonggui'],
    ['tongjian-v294-p52', 'chai-rong'], ['tongjian-v268-p64', 'zhu-wen'], ['tongjian-v282-p96', 'shi-jingtang'],
  ]) {
    assert.ok(paragraphs.get(paragraphId).original.startsWith('帝'), paragraphId);
    assert.equal(association(paragraphId, personId)?.kind, 'record', `${paragraphId}: ${personId}`);
  }
  assert.equal(association('tongjian-v266-p8', 'zhu-wen')?.kind, 'record', 'the explicit King of Liang succession record is present');
});

test('validator rejects stale originals, unknown references, duplicate associations and invalid Unicode bounds', () => {
  const invalid = change => { const copy = structuredClone(index); change(copy); assert.throws(() => validatePersonPassageIndex(copy, library), /Invalid person passages/); };
  invalid(copy => copy.coverage.paragraphCount--);
  invalid(copy => copy.people[0].id = 'unknown-person');
  invalid(copy => copy.passages[0].chapterId = 'missing-v1');
  invalid(copy => copy.passages[0].spans[0].originalRevision++);
  invalid(copy => copy.passages[0].spans[0].originalSha256 = '0'.repeat(64));
  invalid(copy => copy.passages[0].spans[0].start = 1);
  invalid(copy => copy.passages[0].spans[0].end++);
  invalid(copy => copy.passages[0].id = 'passage-new-v01-p999');
  invalid(copy => copy.passages[0].people.push(copy.passages[0].people[0]));
  invalid(copy => copy.passages[0].people[0].personId = 'unknown-person');
  invalid(copy => copy.passages.push(copy.passages[0]));
  const rare = index.passages.find(passage => paragraphs.get(passage.spans[0].paragraphId).original.length !== passage.spans[0].end);
  assert.ok(rare, 'rare CJK code point coverage');
  assert.equal(rare.spans[0].end, [...paragraphs.get(rare.spans[0].paragraphId).original].length);
  invalid(copy => copy.passages.find(passage => passage.id === rare.id).spans[0].end = paragraphs.get(rare.spans[0].paragraphId).original.length);
});

test('validator supports ordered multi-paragraph spans while rejecting whole-paragraph overlap', () => {
  const copy = structuredClone(index);
  const first = copy.passages.find(passage => passage.spans[0].paragraphId === 'new-v01-p3');
  const next = copy.passages.find(passage => passage.spans[0].paragraphId === 'new-v01-p4');
  first.spans.push(structuredClone(next.spans[0]));
  assert.throws(() => validatePersonPassageIndex(copy, library), /duplicate paragraph/);
  copy.passages = copy.passages.filter(passage => passage !== next);
  assert.equal(validatePersonPassageIndex(copy, library), copy);
  first.spans.reverse();
  assert.throws(() => validatePersonPassageIndex(copy, library), /stable passage ID|span chapter\/order/);
});
