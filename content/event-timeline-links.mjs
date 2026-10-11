import {createHash} from 'node:crypto';
import {readFileSync, readdirSync} from 'node:fs';
import {loadLibrary} from './library.mjs';
import {loadPublishedChapters} from './translations.mjs';
import {loadEventComparisons} from './event-comparisons.mjs';
import {loadPersonTimelines, timelineEvidence} from './person-timelines.mjs';
import {parseEventTimelineLinksDocument, timelineEventIdentity} from '../frontend/src/event-timeline-links-schema.ts';

export const eventTimelineLinksRoot = new URL('./event-timeline-links/', import.meta.url);
const hash = text => createHash('sha256').update(text,'utf8').digest('hex');
const requireValue = (condition, message) => {if (!condition) throw new Error(`Invalid event timeline links: ${message}`);};

/** Validate one shared registration; both directions are derived from its links. */
export function validateEventTimelineLinks(input, library = loadLibrary(), comparisons = loadEventComparisons(library), timelines = loadPersonTimelines(library)) {
  const comparison = comparisons.find(item=>item.id===input?.comparisonId);
  requireValue(comparison, 'comparison identity');
  const eventIds = new Map(timelines.map(timeline=>[timeline.personId,timeline.events.map(event=>event.id)]));
  const document = parseEventTimelineLinksDocument(input,comparison,eventIds);
  const stages = new Map(comparison.stages.map(stage=>[stage.id,stage]));
  const sources = new Map(comparison.sources.map(source=>[source.id,source]));
  const people = new Map(timelines.map(timeline=>[timeline.personId,timeline]));
  const paragraphs = new Map(loadPublishedChapters(library).flatMap(chapter=>chapter.paragraphs.map(paragraph=>[paragraph.id,{chapter,paragraph}])));
  const verifyReference = reference => {
    const record = paragraphs.get(reference.paragraphId), paragraph = record?.paragraph;
    return record?.chapter.id === reference.chapterId && paragraph?.revision === reference.originalRevision
      && hash(paragraph.original) === reference.originalSha256 && paragraph.original.includes(reference.excerpt)
      && paragraph.translation?.text.trim();
  };
  for (const link of document.links) {
    requireValue(comparison.personIds.includes(link.personId), `comparison person ${link.personId}`);
    const event = people.get(link.personId)?.events.find(item=>item.id===link.eventId);
    requireValue(event && hash(timelineEventIdentity(event))===link.eventSha256, `current event ${link.eventId}`);
    const timelineReferences = timelineEvidence(event);
    requireValue(timelineReferences.every(verifyReference), `current published event evidence ${link.eventId}`);
    for (const stageId of link.stageIds) {
      requireValue(stages.has(stageId), `stage ${stageId}`);
      requireValue(link.evidence.some(evidence=>evidence.stageId===stageId), `stage evidence ${link.eventId}/${stageId}`);
    }
    for (const evidence of link.evidence) {
      const stage = stages.get(evidence.stageId), source = sources.get(evidence.sourceId);
      const record = source && paragraphs.get(source.paragraphId), paragraph = record?.paragraph;
      requireValue(link.stageIds.includes(evidence.stageId) && stage?.sourceIds.includes(evidence.sourceId)
        && source && paragraph && record.chapter.id===source.chapterId && record.chapter.bookId===source.bookId
        && paragraph.revision===source.originalRevision && hash(paragraph.original)===source.originalSha256
        && paragraph.translation?.text.trim() && paragraph.original.includes(evidence.excerpt), `comparison evidence ${link.eventId}`);
      requireValue(timelineReferences.some(reference=>reference.paragraphId===evidence.timelineParagraphId
        && reference.excerpt===evidence.timelineExcerpt), `exact timeline evidence ${link.eventId}`);
    }
  }
  return document;
}

export function loadEventTimelineLinks(library = loadLibrary()) {
  const comparisons = loadEventComparisons(library), timelines = loadPersonTimelines(library);
  const documents = readdirSync(eventTimelineLinksRoot).filter(name=>name.endsWith('.json')).sort().map(name=>{
    const document = validateEventTimelineLinks(JSON.parse(readFileSync(new URL(name,eventTimelineLinksRoot),'utf8')),library,comparisons,timelines);
    requireValue(name===`${document.comparisonId}.json`, 'document filename');
    return document;
  });
  requireValue(documents.length>0 && new Set(documents.map(document=>document.comparisonId)).size===documents.length, 'unique comparison documents');
  return documents;
}
