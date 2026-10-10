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
const generals = JSON.parse(readFileSync(new URL('../content/five-dynasties/zhu-wen-generals.json', import.meta.url), 'utf8'));
const generalIds = new Set(generals.memberIds);
const keyongGenerals = JSON.parse(readFileSync(new URL('../content/five-dynasties/li-keyong-generals.json', import.meta.url), 'utf8'));
const keyongNewIds = new Set(keyongGenerals.people.map(person => person.id));
const tenKingdoms = JSON.parse(readFileSync(new URL('../content/five-dynasties/ten-kingdoms-rulers.json', import.meta.url), 'utf8'));
const tenKingdomIds = new Set(tenKingdoms.people.map(person => person.id));

test('generation scans the whole canonical archive and reproduces the saved shared index', () => {
  assert.deepEqual(buildPersonPassageIndex(library), index);
  assert.deepEqual(index.people, loadPassagePeople());
  assert.deepEqual(index.coverage, { bookCount: library.catalog.books.length, chapterCount: library.chapters.length,
    paragraphCount: library.chapters.reduce((sum, chapter) => sum + chapter.paragraphs.length, 0) });
  assert.equal(index.scope, 'current-archive');
  const bookByChapter = new Map(library.chapters.map(chapter => [chapter.id, chapter.bookId]));
  assert.equal(new Set(index.passages.map(passage => bookByChapter.get(passage.chapterId))).size, library.catalog.books.length);
  for (const person of index.people) {
    if (!generalIds.has(person.id) && !keyongNewIds.has(person.id) && !tenKingdomIds.has(person.id)) {
      for (const bookId of ['old', 'new']) assert.ok(index.passages.some(passage => passage.chapterId.startsWith(`${bookId}-`)
        && passage.people.some(item => item.personId === person.id && item.kind === 'biography')), `${bookId} biography: ${person.id}`);
    }
  }
});

test('all Ten Kingdom rulers share the canonical registry and their checked actual source sections', () => {
  assert.equal(tenKingdoms.people.length, 43);
  for (const person of tenKingdoms.people) {
    assert.equal(index.people.filter(p => p.id === person.id).length, 1, person.id);
    const biographies = rules.sections.filter(r => r.personId === person.id && r.kind === 'biography');
    assert.ok(biographies.length, `${person.id}: a verified principal record`);
    for (const section of biographies) {
      const chapter = library.chapters.find(c => c.id === section.chapterId);
      for (const paragraph of chapter.paragraphs.slice(section.start - 1, section.end)) {
        assert.equal(association(paragraph.id, person.id)?.kind, 'biography', `${person.id}: ${paragraph.id}`);
      }
    }
    for (const [bookId, chapterId] of Object.entries(person.readingStarts)) {
      assert.ok(library.chapters.some(c => c.id === chapterId && c.bookId === bookId), `${person.id}: real ${bookId} source`);
      assert.ok(index.passages.some(p => p.chapterId === chapterId && p.people.some(a => a.personId === person.id && a.kind !== 'mention')),
        `${person.id}: a related record in ${chapterId}`);
    }
  }
  assert.equal(association('new-v70-p29', 'liu-jiyuan')?.kind, 'biography', 'the 979 surrender remains in his biography');
  assert.equal(association('new-v67-p25', 'qian-hongcong')?.kind, 'biography', 'the short reign embedded in Qian Chu’s section is retained');
  assert.equal(association('new-v68-p32', 'zhuo-yanming')?.kind, 'biography', 'the local contested rule has its actual shared paragraph');
  assert.equal(association('old-v135-p21', 'liu-chengjun')?.kind, 'record', 'old history’s brief accession is a record, not an invented independent biography');
});

test('Ten Kingdom identities do not absorb other rulers, officers, ordinary words or single names', () => {
  for (const [personId, paragraphIds] of Object.entries({
    'wang-jian-former-shu': ['old-v010-p8', 'old-v036-p8', 'old-v043-p6', 'tongjian-v271-p83', 'tongjian-v279-p13',
      'new-v62-p22', 'new-v66-p4', 'huiyao-v026-p24', 'old-v022-p4', 'old-v023-p23', 'tongjian-v286-p29'],
    'liu-min-northern-han': ['old-v001-p2', 'old-v001-p22', 'new-v13-p4', 'new-v65-p3', 'tongjian-v269-p15'],
    'meng-zhixiang': ['new-v61-p46', 'tongjian-v267-p39'],
    'wang-yanhan': ['old-v043-p6', 'new-v62-p10', 'tongjian-v285-p35'],
    'wang-yanjun': ['tongjian-v290-p120'],
    'zhu-wenjin': ['old-v004-p1', 'old-v103-p12', 'old-v103-p14'],
    'ma-xichong': ['old-v076-p3'],
    'gao-jichong': ['new-v70-p15'],
  })) for (const paragraphId of paragraphIds) {
    assert.equal(association(paragraphId, personId), undefined, `${paragraphId}: ${personId}`);
  }
  for (const [id, personId] of [
    ['old-v015-p2', 'wang-jian-former-shu'], ['old-v033-p10', 'wang-yan-former-shu'],
    ['tongjian-v275-p91', 'meng-chang'], ['tongjian-v291-p64', 'liu-chang-southern-han'],
    ['old-v083-p2', 'zhu-wenjin'], ['new-v61-p25', 'li-bian'], ['new-v69-p17', 'gao-jichong'],
  ]) assert.ok(association(id, personId), `${id}: preserve the correctly identified shared record`);
  assert.ok(!association('new-v68-p19', 'meng-chang'), 'Min’s Wang Chang is not Meng Chang');
  assert.ok(!association('new-v64-p18', 'wang-jipeng'), 'Later Shu’s Meng Chang is not Wang Jipeng');
  assert.ok(association('tongjian-v270-p37', 'wang-jian-former-shu'), 'the dated Shu-ruler death and accession record belongs to Wang Jian');
});

test('the combined Li Keyong and Li Cunxu topic shares identities without conflating service periods', () => {
  assert.equal(keyongGenerals.memberIds.length, 87);
  assert.equal(keyongGenerals.people.length, 58);
  assert.ok(!keyongGenerals.memberIds.includes('li-cunxu'), 'the commander is not counted as his own general');
  assert.ok(keyongGenerals.memberIds.includes('yan-bao'));
  assert.equal(keyongGenerals.memberRelationshipSubjects['yan-bao'], '李存勖', 'joining the son does not imply service under the father');
  for (const id of ['guo-chongtao', 'kang-sili', 'zhang-qianzhao']) {
    assert.equal(keyongGenerals.memberRelationshipSubjects[id], '李克用、李存勖', `${id}: verified service in both generations`);
  }
  assert.equal(keyongGenerals.memberRelationshipSubjects['ren-huan'], '李继岌', 'the campaign commander actually issued Ren Huan’s army appointment');
  for (const person of keyongGenerals.people) {
    assert.equal(index.people.filter(item => item.id === person.id).length, 1);
    for (const chapterId of Object.values(person.readingStarts)) {
      assert.ok(index.passages.some(passage => passage.chapterId === chapterId
        && passage.people.some(link => link.personId === person.id && link.kind !== 'mention')), `${person.id}: ${chapterId}`);
    }
  }
  for (const id of ['guo-chongtao', 'yuan-xingqin', 'xia-luqi', 'fu-xi', 'wu-zhen', 'zhu-shouyin', 'kang-yanxiao', 'li-jiji', 'li-congjing', 'ren-huan']) {
    assert.equal(index.people.filter(person => person.id === id).length, 1, id);
  }
  assert.equal(association('new-v25-p55', 'xifang-ye')?.kind, 'biography', 'the complete verified biography continues through its final paragraph');
  assert.ok(association('new-v46-p38', 'wang-jianli'), 'the son’s first paragraph explicitly mentions his father');
  for (const paragraphId of ['new-v46-p39', 'new-v46-p40']) {
    assert.equal(association(paragraphId, 'wang-jianli'), undefined, 'independent records of Wang Shouen are not assigned to Wang Jianli');
  }
  assert.equal(association('old-v070-p6', 'li-yan-youzhou')?.kind, 'biography');
  assert.equal(association('old-v037-p4', 'li-yan-youzhou'), undefined, 'the Fengxiang governor Li Yan is Li Congyan, not the Youzhou envoy');
  assert.ok(association('old-v037-p5', 'li-yan-youzhou'), 'the guest envoy in this paragraph is the Youzhou Li Yan');
  assert.equal(association('old-v065-p1', 'wang-jianji')?.kind, 'biography');
  assert.equal(association('new-v25-p32', 'wang-jianji')?.kind, 'biography');
  assert.equal(association('old-v061-p10', 'liu-xun-yonghe')?.kind, 'biography');
  assert.equal(association('old-v061-p10', 'liu-xun'), undefined, 'Liu Xun is distinct from Liu Xin');
  assert.equal(association('old-v055-p2', 'an-xiuxiu')?.kind, 'record');
  assert.equal(association('old-v015-p9', 'an-xiuxiu')?.kind, 'record');
  assert.equal(association('new-v36-p20', 'an-xiuxiu')?.kind, 'record');
  assert.equal(association('new-v25-p28', 'shi-jiantang')?.kind, 'record');
  assert.equal(association('new-v25-p29', 'shi-jiantang'), undefined, 'an independent descendant does not inherit the father');
  assert.equal(association('new-v25-p30', 'shi-jiantang'), undefined);
  assert.equal(association('old-v015-p11', 'li-sizhao')?.kind, 'record', 'the transposed name is locally identified by the actual military event');
  assert.equal(association('old-v015-p11', 'zhu-wen')?.kind, 'record');
});

test('every declared general reading entrance and checked biography range is indexed', () => {
  assert.equal(generals.people.length, 53);
  assert.equal(generals.memberIds.length, 53);
  assert.deepEqual(new Set(generals.people.map(person => person.id)), generalIds);
  for (const person of generals.people) {
    assert.ok(index.people.some(item => item.id === person.id && item.name === person.name), person.id);
    for (const [bookId, chapterId] of Object.entries(person.readingStarts)) {
      assert.ok(library.chapters.some(chapter => chapter.id === chapterId && chapter.bookId === bookId), person.id);
      assert.ok(index.passages.some(passage => passage.chapterId === chapterId
        && passage.people.some(item => item.personId === person.id && item.kind !== 'mention')), `${person.id}: ${chapterId}`);
    }
    const sections = rules.sections.filter(range => range.personId === person.id);
    assert.ok(sections.length > 0, `checked source ranges: ${person.id}`);
    for (const section of sections) {
      const chapter = library.chapters.find(item => item.id === section.chapterId);
      for (const paragraph of chapter.paragraphs.slice(section.start - 1, section.end)) {
        assert.equal(association(paragraph.id, person.id)?.kind, section.kind, `${paragraph.id}: ${person.id}`);
      }
    }
  }
  assert.ok(rules.sections.filter(range => range.personId === 'li-zhouyi').every(range => range.kind === 'record'),
    'Li Zhouyi has related records rather than a fabricated standalone biography');
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

test('Li Keyong general short names exclude other historical people and word-boundary collisions', () => {
  const excluded = {
  "an-jinquan": [
    "beimeng-v019-p33",
    "huiyao-v024-p38",
    "new-v08-p7",
    "new-v08-p10",
    "old-v040-p7",
    "old-v044-p6",
    "old-v048-p4",
    "old-v076-p12",
    "old-v076-p14",
    "old-v076-p16",
    "old-v079-p5",
    "old-v101-p12",
    "old-v115-p21",
    "tongjian-v278-p21",
    "tongjian-v281-p44",
    "tongjian-v281-p47",
    "tongjian-v281-p52",
    "tongjian-v281-p59",
    "tongjian-v282-p58",
    "tongjian-v282-p60",
    "tongjian-v282-p64",
    "tongjian-v287-p32",
    "tongjian-v288-p67",
    "tongjian-v289-p8"
  ],
  "an-zhongba": [
    "new-v13-p46",
    "old-v002-p10",
    "old-v004-p9",
    "old-v006-p13",
    "old-v009-p7",
    "old-v027-p8",
    "kaoyi-v028-p36",
    "old-v112-p9",
    "tongjian-v290-p116",
    "tongjian-v274-p58"
  ],
  "zhou-dewei": [
    "huiyao-v006-p50",
    "huiyao-v017-p36",
    "tongjian-v280-p12"
  ],
  "liu-yancong": [
    "old-v044-p3"
  ],
  "yuan-jianfeng": [
    "beimeng-v018-p15",
    "tongjian-v276-p46"
  ],
  "wang-jianji": [
    "tongjian-v289-p70"
  ],
  "zhang-tingyu": [
    "tongjian-v283-p49"
  ],
  "li-hanzhi": [
    "tongjian-v277-p130"
  ],
  "an-xiuxiu": [
    "quewen-v001-p12"
  ]
};
  for (const [personId, ids] of Object.entries(excluded)) for (const paragraphId of ids) {
    assert.equal(association(paragraphId, personId), undefined, paragraphId + ': ' + personId);
  }
  for (const paragraphId of ['old-v061-p18','tongjian-v274-p72','tongjian-v279-p92','tongjian-v280-p17']) assert.ok(association(paragraphId, 'an-jinquan'));
  for (const paragraphId of ['old-v061-p18','new-v46-p30','new-v46-p31']) assert.ok(association(paragraphId, 'an-zhongba'));
  assert.ok(association('old-v036-p6', 'liu-xun-yonghe'));
  assert.ok(association('old-v036-p6', 'zhang-tingyu'));
});

test('Li Cunxu generals exclude namesakes, ordinary words and cross-word names while retaining verified records', () => {
  // These are fixed source examples, independent of the current exclusion rule list.
  const excluded = {
    'guo-chongtao': ['tongjian-v292-p47', 'tongjian-v293-p86', 'tongjian-v294-p60'], // Zhao Chongtao
    'suo-zitong': ['tongjian-v280-p33', 'huiyao-v025-p21'], // the verb 自通
    'li-shaowen': ['tongjian-v268-p34'], // 從楚王殷 is not Zhang Congchu
    'yang-yanwen': [
      'old-v034-p11', 'old-v035-p18', 'old-v041-p15', 'new-v05-p14',
      'old-v022-p18', 'old-v023-p3', 'new-v22-p10', 'tongjian-v274-p77',
      'tongjian-v277-p28', 'tongjian-v277-p51', 'tongjian-v282-p64',
      'tongjian-v289-p68', 'tongjian-v289-p76', 'kaoyi-v029-p57',
    ], // Yao, Bian, Wang, Qi/Ji, Cheng and Li Yanwen are separate people
    'zhao-zaili': ['old-v005-p2', 'huiyao-v002-p26', 'huiyao-v030-p74'], // ordinary 在禮 and 禮賓使
    'fang-zhiwen': ['old-v028-p1', 'old-v056-p8', 'tongjian-v268-p38'], // Liu Zhiwen
    'li-congjing': ['old-v103-p12'], // Xin Congshen
    'li-yan-youzhou': ['old-v010-p17', 'old-v032-p3', 'old-v037-p4'], // Liang official / Fengxiang governor
    'li-jiji': ['tongjian-v269-p86'], // the Baosheng general who resumed his name Sang Hongzhi
  };
  const sourceTerms = {
    'guo-chongtao': /崇韜/, 'suo-zitong': /自通/, 'li-shaowen': /從楚/,
    'yang-yanwen': /彥溫|彦温/, 'zhao-zaili': /在禮/, 'fang-zhiwen': /知溫/,
    'li-congjing': /從審/, 'li-yan-youzhou': /李嚴/, 'li-jiji': /繼岌/,
  };
  assert.equal(Object.values(excluded).flat().length, 31);
  for (const [personId, paragraphIds] of Object.entries(excluded)) for (const paragraphId of paragraphIds) {
    assert.match(paragraphs.get(paragraphId).original, sourceTerms[personId], `${paragraphId}: the ambiguous source term exists`);
    assert.equal(association(paragraphId, personId), undefined, `${paragraphId}: ${personId}`);
  }
  for (const paragraphId of ['huiyao-v005-p75', 'huiyao-v013-p22']) {
    assert.ok(paragraphs.get(paragraphId).original.includes('建立'));
    assert.equal(association(paragraphId, 'wang-jianli'), undefined, 'building shrines or a pavilion is not Wang Jianli');
  }
  for (const paragraphId of ['new-v46-p25', 'new-v46-p55']) {
    assert.equal(association(paragraphId, 'gao-xinggui')?.kind, 'mention', 'a textual name dispute cannot become an established military achievement');
  }
  const included = {
    'guo-chongtao': ['old-v057-p2'], 'suo-zitong': ['old-v065-p13'],
    'li-shaowen': ['old-v059-p18'], 'yang-yanwen': ['old-v074-p10'],
    'zhao-zaili': ['new-v46-p2'], 'fang-zhiwen': ['new-v46-p16'],
    'li-congjing': ['new-v25-p40', 'old-v070-p2'], 'li-yan-youzhou': ['old-v070-p6', 'old-v037-p5'],
    'li-jiji': ['old-v033-p5'], 'wang-jianli': ['new-v46-p33'],
    'gao-xinggui': ['old-v065-p6'], 'gao-xingzhou': ['tongjian-v269-p43'],
  };
  for (const [personId, paragraphIds] of Object.entries(included)) for (const paragraphId of paragraphIds) {
    const link = association(paragraphId, personId);
    assert.ok(link, `${paragraphId}: ${personId} retains its verified record`);
    assert.notEqual(link.kind, 'mention', `${paragraphId}: this is an actual person record`);
  }
});
