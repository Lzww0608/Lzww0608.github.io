import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadLibrary} from '../content/library.mjs';
import {loadEventComparisons} from '../content/event-comparisons.mjs';
import {loadPersonTimelines} from '../content/person-timelines.mjs';
import {loadEventTimelineLinks,validateEventTimelineLinks} from '../content/event-timeline-links.mjs';
import {timelineEventIdentity} from '../frontend/src/event-timeline-links-schema.ts';

const library=loadLibrary(),comparisons=loadEventComparisons(library),timelines=loadPersonTimelines(library);
const [document]=loadEventTimelineLinks(library);
const check=(value,otherTimelines=timelines,otherLibrary=library)=>validateEventTimelineLinks(value,otherLibrary,comparisons,otherTimelines);
const mutate=callback=>{const value=structuredClone(document);callback(value);return value;};

test('Baixiang derives both reading directions from the 12 evidenced events of 10 existing people',()=>{
  assert.equal(document.comparisonId,'baixiang');assert.equal(document.links.length,12);
  assert.equal(new Set(document.links.map(link=>link.personId)).size,10);
  assert.equal(document.links.reduce((sum,link)=>sum+link.stageIds.length,0),14);
  const count=id=>document.links.filter(link=>link.stageIds.includes(id)).length;
  assert.equal(count('background'),2);assert.equal(count('preparation'),1);assert.equal(count('battle'),7);assert.equal(count('aftermath'),4);
  assert.deepEqual(document.links.find(link=>link.eventId==='zhu-wen-attack-zhao').stageIds,['background']);
  assert.deepEqual(document.links.find(link=>link.eventId==='yang-shihou-xingzhou').stageIds,['aftermath']);
  assert.deepEqual(document.links.find(link=>link.eventId==='wang-jingren-north-command').stageIds,['background','preparation']);
  assert.ok(!document.links.some(link=>['li-siyuan-xingzhou','yang-shihou-zaoqiang','zhu-wen-north-return'].includes(link.eventId)));
});

test('links bind current event facts and preserve range/date variants without guessing years',()=>{
  const person=timelines.find(timeline=>timeline.personId==='wang-jingren');
  const north=person.events.find(event=>event.id==='wang-jingren-north-command');
  assert.equal(north.year,null);assert.deepEqual(north.yearRange,{start:910,end:911});
  const battle=person.events.find(event=>event.id==='wang-jingren-baixiang');
  assert.ok(battle.variants.some(variant=>variant.year===908));
  const hash=createHash('sha256').update(timelineEventIdentity(north)).digest('hex');
  assert.equal(document.links.find(link=>link.eventId===north.id).eventSha256,hash);
  const changed=structuredClone(timelines);changed.find(item=>item.personId==='li-cunxu').events.find(event=>event.id==='li-cunxu-baixiang').summary+=' 改写';
  assert.throws(()=>check(document,changed),/current event/);
  assert.throws(()=>check(mutate(value=>value.links[0].eventId='li-cunxu-youzhou')),/current event/);
});

test('same-year or same-paragraph evidence cannot silently become a different event or stage link',()=>{
  assert.throws(()=>check(mutate(value=>value.links[0].evidence[0].excerpt='没有真实出处的柏乡胜利')),/comparison evidence/);
  assert.throws(()=>check(mutate(value=>value.links[0].evidence[0].timelineExcerpt='天祐八年正月丁亥')),/exact timeline evidence/);
  assert.throws(()=>check(mutate(value=>{value.links[0].stageIds=['preparation'];value.links[0].evidence[0].stageId='preparation';})),/Invalid event timeline/);
  assert.throws(()=>check(mutate(value=>value.links[0].evidence[0].timelineParagraphId='old-v028-p13')),/exact timeline evidence/);
});

test('prebuild rejects duplicate registrations, private fields, unproved phases and unknown identities',()=>{
  assert.throws(()=>check(mutate(value=>value.links.push(structuredClone(value.links[0])))),/Invalid event timeline/);
  assert.throws(()=>check({...document,privateReview:'secret'}),/Invalid event timeline/);
  assert.throws(()=>check(mutate(value=>value.links[0].privateReview='secret')),/Invalid event timeline/);
  assert.throws(()=>check(mutate(value=>value.links[0].stageIds.push('aftermath'))),/Invalid event timeline/);
  assert.throws(()=>check(mutate(value=>value.links[0].personId='no-person')),/Invalid event timeline/);
  assert.throws(()=>check(mutate(value=>value.comparisonId='not-this-comparison')),/comparison identity/);
});

test('a refreshed event hash cannot authorise stale original bindings or invented timeline evidence',()=>{
  for(const change of [reference=>{reference.originalSha256='0'.repeat(64);},reference=>{reference.excerpt='虚构原文';}]) {
    const changed=structuredClone(timelines), value=structuredClone(document);
    const event=changed.find(item=>item.personId==='li-cunxu').events.find(event=>event.id==='li-cunxu-baixiang');
    change(event.evidence[0]);
    value.links[0].eventSha256=createHash('sha256').update(timelineEventIdentity(event)).digest('hex');
    assert.throws(()=>check(value,changed),/current published event evidence/);
  }
  const changed=structuredClone(comparisons);
  changed[0].sources.find(source=>source.id==='old-v027-p18').originalSha256='0'.repeat(64);
  assert.throws(()=>validateEventTimelineLinks(document,library,changed,timelines),/comparison evidence/);
});
