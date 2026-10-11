import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLibrary } from '../content/library.mjs';
import { loadPersonTimelines, validatePersonTimeline, timelineEvidence, buildTimelineSummary } from '../content/person-timelines.mjs';

const library = loadLibrary();
const documents = loadPersonTimelines(library);
const byPerson = new Map(documents.map(document => [document.personId, document]));

test('both individual timelines resolve all primary and alternative citations in the current archive', () => {
  assert.deepEqual([...byPerson.keys()].sort(), ['li-cunxu', 'li-keyong']);
  assert.equal(documents.reduce((n, document) => n + document.events.length, 0), 52);
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
  assert.equal(summary.people.some(person => person.personId === 'zhu-wen'), false);
});

test('stale references, invented sources and duplicate citations are rejected before database writes', () => {
  const invalid = change => {
    const document = structuredClone(documents[0]); change(document);
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
    const document = structuredClone(documents[0]); change(document);
    assert.throws(() => validatePersonTimeline(document, library), /Invalid person timeline/);
  };
  invalid(document => document.personId = 'unknown');
  invalid(document => document.events = []);
  invalid(document => document.events[0].id = documents[1].events[0].id);
  invalid(document => document.events[1].id = document.events[0].id);
  invalid(document => document.events.reverse());
  invalid(document => document.events[0].year = 885.5);
  invalid(document => document.events[0].precision = 'guessed');
  invalid(document => document.audit = { humanReviewed: true });
  invalid(document => document.events[0].evidence[0].translation = '截译');
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
