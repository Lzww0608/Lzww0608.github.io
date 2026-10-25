import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLibrary } from '../content/library.mjs';
import { loadPersonTimelines, validatePersonTimeline, validateTimelineCoverage, timelineEvidence, buildTimelineSummary } from '../content/person-timelines.mjs';

const library = loadLibrary();
const documents = loadPersonTimelines(library);
const byPerson = new Map(documents.map(document => [document.personId, document]));
const baseline = byPerson.get('li-cunxu');

test('all saved timelines resolve their primary and alternative citations without changing the original two', () => {
  const originalEventIds = {
    'li-cunxu': (`birth follow-father succeed-jin lu-encampment baixiang
      youzhou yan-captives weibo yuancheng rescue-youzhou
      huliu desheng zhenzhou-siege wangdu zhenzhou-taken
      imperial-accession liang-falls arrive-luoyang performers-patronage conquer-shu
      guo-chongtao-killed purge-and-hunger weibo-revolt failed-march xingjiao-death
      burial`).split(/\s+/).map(id => 'li-cunxu-' + id),
    'li-keyong': (`birth youth-campaign yunzhou-mutiny dada-exile recalled-to-fight-huangchao
      southward-army recover-changan hedong-governorship shangyuan-attack shayuan-battle
      imperial-campaign-against-hedong restored-and-yunzhou li-cunxiao-executed enter-youzhou relieve-zhaozong
      prince-of-jin huanshui-defeat ansai-defeat hezhong-lost defend-jinyang
      khitan-alliance yan-lu-campaign refuse-liang rescue-luzhou death-and-succession
      posthumous-emperor`).split(/\s+/).map(id => 'li-keyong-' + id),
  };
  for (const [personId, eventIds] of Object.entries(originalEventIds)) {
    const preservedIds = new Set(eventIds);
    assert.deepEqual(byPerson.get(personId).events.filter(event => preservedIds.has(event.id)).map(event => event.id), eventIds,
      `${personId}: original stable events retain their relative order while sourced additions may be inserted`);
  }
  for (const document of documents) {
    assert.equal(validatePersonTimeline(document, library), document);
    for (const event of document.events) assert.ok(timelineEvidence(event).length > 0);
  }
});

test('future entries and safe event identities derive from actual validated person documents', () => {
  const summary = buildTimelineSummary(documents);
  assert.equal(summary.scope, 'current-archive');
  for (const person of summary.people) {
    const source = byPerson.get(person.personId);
    assert.deepEqual(person.eventIds, source.events.map(event => event.id));
    assert.equal(person.eventCount, source.events.length);
  }
  assert.equal(summary.people.some(person => person.personId === 'unregistered-person'), false);
});

test('stale references, invented sources and duplicate citations are rejected before database writes', () => {
  const invalid = change => {
    const document = structuredClone(baseline); change(document);
    assert.throws(() => validatePersonTimeline(document, library), /Invalid person timeline/);
  };
  invalid(document => document.events[0].evidence[0].originalRevision++);
  invalid(document => document.events[0].evidence[0].originalSha256 = '0'.repeat(64));
  invalid(document => document.events[0].evidence[0].excerpt += '不存在的史料');
  invalid(document => document.events[0].evidence[0].chapterId = 'unknown');
  invalid(document => document.events[0].evidence.push(document.events[0].evidence[0]));
  invalid(document => document.events[0].variants[0].evidence[0].originalSha256 = '0'.repeat(64));
});

test('unregistered identities, unsorted events and private audit metadata cannot enter public documents', () => {
  const invalid = change => {
    const document = structuredClone(baseline); change(document);
    assert.throws(() => validatePersonTimeline(document, library), /Invalid person timeline/);
  };
  invalid(document => document.personId = 'unknown');
  invalid(document => document.events = []);
  invalid(document => document.events[0].id = byPerson.get('li-keyong').events[0].id);
  invalid(document => document.events[1].id = document.events[0].id);
  invalid(document => document.events.reverse());
  invalid(document => document.events[0].year = 885.5);
  invalid(document => document.events[0].precision = 'guessed');
  invalid(document => document.audit = { humanReviewed: true });
  invalid(document => document.events[0].evidence[0].translation = '截译');
});

test('unknown dates and sourced year ranges remain explicit, sort after dated events and never become fake years', () => {
  const input = structuredClone(baseline), source = input.events[0];
  input.events = [source, { ...structuredClone(source), id: 'li-cunxu-range-fixture', year: null, yearRange: { start: 913, end: 914 },
    precision: 'range', phase: 'uncertain', sortOrder: 90 }, { ...structuredClone(source), id: 'li-cunxu-undated-fixture',
    year: null, precision: 'undated', phase: 'uncertain', sortOrder: 91 }];
  assert.equal(validatePersonTimeline(input, library), input);
  for (const change of [doc => doc.events[1].yearRange.end = 912, doc => doc.events[1].year = 913,
    doc => doc.events[1].yearRange.start = 913.5, doc => doc.events[1].precision = 'month',
    doc => doc.events[2].phase = 'service', doc => doc.events[2].sortOrder = 90, doc => doc.events.reverse()]) {
    const changed = structuredClone(input); change(changed);
    assert.throws(() => validatePersonTimeline(changed, library), /Invalid person timeline/);
  }
});

test('adding a person to the registry requires its timeline instead of accepting a silent missing entry', () => {
  const existing = ['li-cunxu', 'li-keyong'].map(id => byPerson.get(id));
  const registry = existing.map(document => ({ id: document.personId }));
  assert.equal(validateTimelineCoverage(existing, registry).people, 2);
  assert.throws(() => validateTimelineCoverage(existing, [...registry, { id: 'new-person-fixture' }]), /missing person timelines: new-person-fixture/);
  assert.throws(() => validateTimelineCoverage([...existing, existing[0]], registry), /unique person coverage/);
});

test('cross-year evidence preserves source dates and different chronologies without merging them', () => {
  const event = (person, id) => byPerson.get(person).events.find(event => event.id === `${person}-${id}`);
  assert.equal(event('li-keyong', 'shayuan-battle').year, 886);
  assert.equal(event('li-keyong', 'enter-youzhou').year, 895);
  const jin = event('li-keyong', 'prince-of-jin');
  assert.equal(jin.year, 896); assert.equal(jin.variants[0].year, 895);
  assert.match(jin.sourceDate, /乾宁二年十二月乙未/);
  assert.equal(event('li-cunxu', 'huliu').year, 919);
  assert.equal(event('li-cunxu', 'arrive-luoyang').year, 924);
  assert.equal(event('li-cunxu', 'youzhou').year, 913);
  assert.equal(event('li-cunxu', 'yan-captives').year, 914);
  assert.equal(event('li-cunxu', 'birth').variants.find(variant => variant.label.includes('五代会要')).year, 886);
  assert.equal(event('li-keyong', 'posthumous-emperor').phase, 'posthumous');
  assert.equal(event('li-cunxu', 'succeed-jin').year, 908);
  assert.equal(event('li-cunxu', 'imperial-accession').year, 923);
});
