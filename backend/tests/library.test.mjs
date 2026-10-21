import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadLibrary } from '../../content/library.mjs';
const { catalog, chapters } = loadLibrary();

test('the archive has verified source hashes, complete emperor and Li Keyong annals and all Five Dynasties Tongjian volumes', () => {
  assert.equal(chapters.length, 218);
  assert.equal(chapters.reduce((sum, chapter) => sum + chapter.paragraphs.length, 0), 9014);
  assert.deepEqual(catalog.books.map(book => book.id), ['old', 'new', 'tongjian', 'quewen', 'shibu', 'chunqiu', 'huiyao', 'beimeng', 'kaoyi', 'shiguochunqiu', 'nantanglu', 'nantangma']);
  const emperors = JSON.parse(readFileSync(new URL('../../content/five-dynasties/emperors.json', import.meta.url), 'utf8')).people;
  assert.equal(emperors.length, 14);
  for (const person of emperors) {
    for (const [bookId, chapterId] of Object.entries(person.readingStarts)) {
      assert.ok(catalog.chapters.some(c => c.id === chapterId && c.bookId === bookId && c.subjects.includes(person.id)), `${person.id}: ${bookId}`);
    }
  }
  assert.deepEqual(catalog.chapters.filter(c => c.bookId === 'old').map(c => c.volume).sort((a,b) => a-b),
    [1,2,3,4,5,6,7,8,9,10,11,12,13,15,16,19,20,21,22,23,25,26, ...Array.from({length:22},(_,i)=>27+i),49,52,53,55,56,57,59,61,62,63,64,65,70,73,74, ...Array.from({length:12},(_,i)=>75+i),91, ...Array.from({length:6},(_,i)=>99+i), ...Array.from({length:12},(_,i)=>110+i),133,134,135,136]);
  assert.deepEqual(catalog.chapters.filter(c => c.bookId === 'new').map(c => c.volume).sort((a,b) => a-b), [...Array.from({length:20},(_,i)=>i+1),21,22,23,25,32,36,39,43,44,45,46,51,...Array.from({length:10},(_,i)=>61+i)]);
  assert.deepEqual(catalog.chapters.filter(c => c.bookId === 'tongjian').map(c => c.volume), Array.from({ length: 29 }, (_, i) => 266 + i));
  assert.ok(chapters.every(c => c.scope === 'full' && c.paragraphs.every(p => p.translation === null)));
  assert.ok(chapters.find(c => c.id === 'old-v001').paragraphs.some(p => p.original.includes('永樂大典')));
  assert.ok(chapters.find(c => c.id === 'tongjian-v272').paragraphs.some(p => p.original.includes('莊宗光聖神閔孝皇帝')));
  assert.equal(chapters.find(c => c.id === 'old-v025').paragraphs.length, 27);
  assert.equal(chapters.find(c => c.id === 'old-v026').paragraphs.length, 42);
  assert.ok(chapters.find(c => c.id === 'old-v026').paragraphs.some(p => p.original.includes('追諡武皇帝，廟號太祖')));
  const palace = chapters.find(c => c.id === 'old-v011');
  const palaceSummary = catalog.chapters.find(c => c.id === palace.id);
  assert.equal(palace.paragraphs.length, 6);
  assert.equal(palaceSummary.characterCount, 1311);
  assert.equal(palaceSummary.provenance.revisionId, 2186156);
  assert.deepEqual(palace.paragraphs.map(p => p.id), Array.from({ length: 6 }, (_, i) => `old-v011-p${i + 1}`));
  assert.deepEqual([palace.paragraphs[0].original, palace.paragraphs[2].original, palace.paragraphs[4].original], ['文惠皇太后', '元貞皇后', '德妃 張氏']);
  assert.ok(palace.paragraphs[3].original.includes('乾化二年十一月二十三日'));
  assert.ok(palace.paragraphs[5].original.includes('《歐陽史次妃郭氏傳》'));
  assert.ok(palace.paragraphs[5].original.includes('是金華公主實歸羅氏'));
  const quewen = chapters.find(c => c.id === 'quewen-v001').paragraphs.map(p => p.original).join('');
  assert.ok(quewen.includes('宋王禹偁撰') && quewen.includes('皆聞於耆老者也') && quewen.includes('王樸'));
});

test('Later Tang, Jin, Han and Zhou household and supporting biography volumes retain fixed complete originals and textual notes', () => {
  for (const [id, count, characters, revision, opening, ending] of [
    ['old-v049', 31, 4667, 2186155, '武皇帝', '《會要》不載莊宗女'],
    ['new-v14', 50, 6722, 2292410, '正室劉氏　次妃曹氏', '冊封則在四月己卯'],
    ['new-v15', 45, 5348, 1699112, '皇后曹氏　皇后夏氏', '待考。'],
    ['new-v16', 10, 894, 2292660, '皇后劉氏', '存之所以戒也。'],
    ['old-v086', 6, 1949, 1567203, '◎后妃', '並天福七年五月封。'],
    ['new-v17', 58, 5744, 1699172, '高祖皇后李氏', '他本均無「大」字。'],
    ['old-v104', 3, 807, 1567204, '◎后妃', '追封秦國長公主。'],
    ['new-v18', 19, 2167, 1699189, '皇后李氏', '傳，先贇而後信，亦便於述事爾。'],
    ['old-v121', 11, 2817, 1567208, '后妃', '又追封梁國長公主。'],
    ['new-v19', 17, 1301, 1699202, '皇后柴氏', '一作「太保」，一作「太尉」。待考。'],
    ['new-v20', 17, 1909, 1699231, '柴守禮', '有「王」字。'],
    ['new-v39', 54, 8718, 1721611, '王鎔', '此鎮海當是橫海之誤'],
    ['new-v51', 57, 8801, 1727238, '朱守殷', '作「坊州」。'],
    ['old-v091', 32, 6696, 2100871, '房知溫', '贈司徒。'],
  ]) {
    const chapter = chapters.find(chapter => chapter.id === id);
    const summary = catalog.chapters.find(chapter => chapter.id === id);
    assert.equal(chapter.paragraphs.length, count, id);
    assert.equal(chapter.paragraphs.reduce((sum, p) => sum + [...p.original].length, 0), characters, id);
    assert.equal(summary.provenance.revisionId, revision, id);
    assert.equal(chapter.paragraphs[0].original, opening, id);
    assert.ok(chapter.paragraphs.at(-1).original.includes(ending), id);
    assert.deepEqual(chapter.paragraphs.map(p => p.id), Array.from({ length: count }, (_, i) => `${id}-p${i + 1}`));
  }
  const hanOld = chapters.find(chapter => chapter.id === 'old-v104');
  const hanNew = chapters.find(chapter => chapter.id === 'new-v18');
  assert.ok(hanOld.paragraphs[2].original.includes('德聖皇太后'));
  assert.ok(hanNew.paragraphs[5].original.includes('昭聖皇太后'));
  assert.ok(hanOld.paragraphs[2].original.includes('隱帝未立皇后'));
  assert.ok(hanNew.paragraphs[14].original.includes('其疑以傳疑，則信者信矣'));
  const jinShared = chapters.find(chapter => chapter.id === 'old-v091');
  assert.ok(jinShared.paragraphs[29].original.includes('尚梁普安公主'));
  assert.ok(jinShared.paragraphs[15].original.includes('為少帝娶從訓長女為妃'));
  assert.ok(jinShared.paragraphs[19].original.includes('楊已終'));
});

test('the thirteen-taibao topic links real biographies without turning its roster into an imperial or adoptive-son list', () => {
  const topic = JSON.parse(readFileSync(new URL('../../content/five-dynasties/taibao.json', import.meta.url), 'utf8'));
  assert.equal(new Set(topic.memberIds).size, 13);
  assert.equal(topic.people.length, 11);
  assert.ok(topic.sourceNote.includes('未将他们列为固定十三人组合'));
  assert.equal(topic.people.some(person => person.reign), false);
  for (const person of topic.people) {
    for (const [bookId, chapterId] of Object.entries(person.readingStarts)) {
      assert.ok(catalog.chapters.some(c => c.id === chapterId && c.bookId === bookId && c.subjects.includes(person.id)), `${person.id}: ${bookId}`);
    }
  }
  assert.ok(chapters.find(c => c.id === 'old-v055').paragraphs.some(p => p.original.includes('敬思')));
  assert.ok(chapters.find(c => c.id === 'new-v25').paragraphs.some(p => p.original.includes('其父敬思')));
  assert.ok(chapters.find(c => c.id === 'new-v36').paragraphs.some(p => p.original.includes('可紀者九人')));
});

test('Zhu Wen generals have traceable service evidence and real selected-biography entries', () => {
  const topic = JSON.parse(readFileSync(new URL('../../content/five-dynasties/zhu-wen-generals.json', import.meta.url), 'utf8'));
  const byChapter = new Map(chapters.map(chapter => [chapter.id, chapter]));
  assert.equal(topic.people.length, 53);
  assert.equal(new Set(topic.people.map(person => person.id)).size, 53);
  assert.deepEqual(topic.memberIds, topic.people.map(person => person.id));
  for (const person of topic.people) {
    assert.equal(person.dynasty, '后梁');
    assert.equal(person.reign, undefined);
    assert.ok(person.nameVariants.length > 0, person.id);
    assert.ok(person.serviceEvidence.length > 0, person.id);
    for (const [bookId, chapterId] of Object.entries(person.readingStarts)) {
      assert.ok(catalog.chapters.some(chapter => chapter.id === chapterId && chapter.bookId === bookId && chapter.subjects.includes(person.id)), `${person.id}: ${bookId}`);
    }
    for (const evidence of person.serviceEvidence) {
      const paragraph = byChapter.get(evidence.chapterId)?.paragraphs.find(p => p.id === evidence.paragraphId);
      assert.ok(paragraph?.original.includes(evidence.excerpt), `${person.id}: ${evidence.paragraphId}`);
      assert.ok(evidence.excerpt.trim().length > 3, person.id);
    }
  }
  assert.ok(byChapter.get('new-v21').paragraphs.some(p => p.original.includes('朱珍') && p.original.includes('唐賓')));
  assert.ok(byChapter.get('new-v46').paragraphs.some(p => p.original.includes('後事梁太祖')));
  assert.ok(byChapter.get('old-v064').paragraphs.some(p => p.original.includes('孔勍')));
});

test('Li Keyong topic reuses existing officers and binds new military evidence to complete selected sources', () => {
  const topic = JSON.parse(readFileSync(new URL('../../content/five-dynasties/li-keyong-generals.json', import.meta.url), 'utf8'));
  const previousPeople = ['emperors', 'taibao', 'zhu-wen-generals'].flatMap(file =>
    JSON.parse(readFileSync(new URL(`../../content/five-dynasties/${file}.json`, import.meta.url), 'utf8')).people);
  const previousIds = new Set(previousPeople.map(person => person.id));
  assert.equal(topic.memberIds.length, 87);
  assert.equal(topic.people.length, 58);
  assert.ok(topic.people.every(person => !previousIds.has(person.id)), 'topic membership reuses an identity, not a duplicate biography');
  assert.equal(topic.memberIds.filter(id => previousIds.has(id)).length, 29);
  assert.equal(topic.relationshipSubject, '李克用');
  assert.equal(topic.memberRelationshipSubjects['yuan-xingqin'], '李存勖');
  assert.equal(topic.memberRelationshipSubjects['guo-chongtao'], '李克用、李存勖');
  assert.equal(topic.memberRelationshipSubjects['ren-huan'], '李继岌');
  assert.ok(!topic.memberIds.includes('li-cunxu') && topic.memberIds.includes('yan-bao'));
  const byChapter = new Map(chapters.map(chapter => [chapter.id, chapter]));
  for (const person of topic.people) {
    assert.equal(person.dynasty, '后唐');
    assert.equal(person.reign, undefined);
    for (const evidence of person.serviceEvidence) {
      assert.ok(byChapter.get(evidence.chapterId)?.paragraphs.find(p => p.id === evidence.paragraphId)?.original.includes(evidence.excerpt), person.id);
    }
    for (const [bookId, chapterId] of Object.entries(person.readingStarts)) {
      assert.ok(catalog.chapters.some(c => c.id === chapterId && c.bookId === bookId && c.subjects.includes(person.id)), person.id);
    }
  }
  assert.deepEqual(topic.people.find(person => person.id === 'wang-jianji').nameVariants, ['王建及', '李建及']);
  assert.equal(topic.people.find(person => person.name === '刘训').id, 'liu-xun-yonghe');
});


test('the five additions retain complete selected volumes, separate prefaces and correct genres', () => {
  for (const [bookId, first, last, hasPreface] of [['shibu',1,5,true], ['chunqiu',1,2,true], ['huiyao',1,30,true], ['beimeng',17,20,true], ['kaoyi',28,30,false]]) {
    const entries = catalog.chapters.filter(c => c.bookId === bookId).sort((a,b) => a.position-b.position);
    assert.deepEqual(entries.map(c => c.volume), [...(hasPreface ? [0] : []), ...Array.from({length:last-first+1}, (_,i) => first+i)]);
    const book = catalog.books.find(b => b.id === bookId);
    assert.equal(entries.find(c => c.id === book.defaultChapter).volume, first);
    assert.ok(entries.every(c => c.provenance.license === catalog.license));
  }
  assert.equal(catalog.books.find(b => b.id === 'huiyao').kind, '典章制度');
  assert.equal(catalog.books.find(b => b.id === 'kaoyi').kind, '史料考证');
  for (const id of ['shibu-v000','chunqiu-v000','huiyao-v000','beimeng-v000']) {
    assert.ok(chapters.find(c => c.id === id).paragraphs.some(p => p.original.includes('撰')));
    const subjects = catalog.chapters.find(c => c.id === id).subjects;
    assert.equal(new Set(subjects).size, subjects.length, `${id}: unique explicitly associated subjects`);
    if (id === 'shibu-v000') assert.ok(subjects.includes('liu-xun-yonghe'), 'the existing author attribution remains');
  }
  assert.ok(chapters.find(c => c.id === 'beimeng-v000').paragraphs.some(p => p.original.includes('北夢瑣言序')));
  assert.ok(chapters.find(c => c.id === 'kaoyi-v028').paragraphs.some(p => p.original === '後梁紀上'));
  assert.ok(chapters.find(c => c.id === 'kaoyi-v030').paragraphs.some(p => p.original.includes('後周紀')));
});
