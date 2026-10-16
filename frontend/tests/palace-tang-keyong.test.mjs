import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPersonPassageIndex } from '../../content/person-passages.mjs';
import { loadPersonTimelines } from '../../content/person-timelines.mjs';
import { filterSearch } from '../src/data.ts';
import { relationshipsForPerson } from '../src/relationships.ts';

test('Li Keyong household separates a surname, a fief title and the two mothers', () => {
  assert.ok(filterSearch('秦國夫人劉氏').some(p => p.id === 'tang-li-keyong-wife-liu'));
  assert.ok(filterSearch('文景皇后秦氏').some(p => p.id === 'tang-li-keyong-mother-qin'));
  const edges = relationshipsForPerson('li-cunxu');
  assert.ok(edges.some(e => e.from === 'tang-li-keyong-wife-liu' && e.label === '嫡母子'));
  assert.ok(edges.some(e => e.from === 'tang-li-keyong-consort-cao' && e.label === '母子'));
  assert.ok(!edges.some(e => e.from === 'tang-li-keyong-wife-liu' && e.kind === 'adoption'));
});

test('new family chapters do not confuse Li Kerang or the courtier Liu Zhi with other men', () => {
  const index = loadPersonPassageIndex();
  const people = pid => index.passages.find(p => p.spans.some(s => s.paragraphId === pid))?.people ?? [];
  for (const pid of ['new-v14-p22', 'new-v14-p24', 'old-v049-p31']) {
    assert.ok(!people(pid).some(p => p.personId === 'zhu-yougong'), pid);
  }
  assert.ok(!people('new-v14-p28').some(p => p.personId === 'ge-congzhou'));
  assert.ok(people('new-v14-p28').some(p => p.personId === 'zhou-dewei'));
  assert.ok(!people('new-v15-p31').some(p => p.personId === 'liu-yan-southern-han'));
  assert.ok(people('new-v16-p10').length > 0);
  assert.ok(people('new-v16-p10').every(p => p.kind === 'mention'));
});

test('Qionghua retains competing parentage and the cross-year investiture', () => {
  const edges = relationshipsForPerson('tang-princess-qionghua');
  assert.ok(edges.some(e => e.from === 'li-keyong' && e.label.includes('说')));
  assert.ok(edges.some(e => e.from === 'li-kerang' && e.label.includes('说')));
  assert.ok(!edges.some(e => [e.from, e.to].includes('meng-chang')));
  const doc = loadPersonTimelines().find(d => d.personId === 'tang-princess-qionghua');
  assert.equal(doc.events.find(e => e.id.endsWith('-title')).year, 926);
  const renamed = doc.events.find(e => e.id.endsWith('-fuqing'));
  assert.equal(renamed.year, 928);
  assert.ok(renamed.variants.some(v => v.year === 930));
  const oldEdge = relationshipsForPerson('meng-zhixiang').find(e => e.id === 'li-keyong-meng-zhixiang-kinship-ten-kingdoms');
  assert.ok(oldEdge.label.includes('异'));
});
