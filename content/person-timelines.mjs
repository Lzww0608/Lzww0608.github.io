import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { loadLibrary } from './library.mjs';
import { loadPassagePeople } from './person-passages.mjs';

export const timelinesRoot = new URL('./person-timelines/', import.meta.url);
export const timelineHash = text => createHash('sha256').update(text, 'utf8').digest('hex');
export const timelinePhases = ['early', 'campaigns', 'rivalry', 'late', 'posthumous', 'jin', 'conquest', 'imperial', 'fall'];
const requireValue = (condition, message) => { if (!condition) throw new Error(`Invalid person timeline: ${message}`); };
const text = (value, max) => typeof value === 'string' && value.trim() && [...value].length <= max;
const only = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => keys.includes(k));
const notes = value => value === undefined || (Array.isArray(value) && value.length <= 20 && value.every(s => text(s, 2000)));
const year = value => Number.isSafeInteger(value) && value >= 1 && value <= 2000;

export function timelineEvidence(event) {
  return [...event.evidence, ...(event.variants ?? []).flatMap(variant => variant.evidence)];
}

export function validatePersonTimeline(input, library = loadLibrary(), people = loadPassagePeople()) {
  requireValue(only(input, ['schemaVersion', 'scope', 'personId', 'events']) && input.schemaVersion === 1
    && input.scope === 'current-archive' && people.some(p => p.id === input.personId), 'person/scope');
  requireValue(Array.isArray(input.events) && input.events.length > 0 && input.events.length <= 500, 'event count');
  const sources = new Map(library.chapters.flatMap(c => c.paragraphs.map(p => [p.id, { chapter: c, paragraph: p }])));
  const ids = new Set(); let previousYear = 0, previousOrder = -1;
  const evidenceList = (list, identity) => {
    requireValue(Array.isArray(list) && list.length > 0 && list.length <= 20, `evidence ${identity}`);
    const seen = new Set();
    for (const evidence of list) {
      requireValue(only(evidence, ['chapterId', 'paragraphId', 'originalRevision', 'originalSha256', 'excerpt']), `evidence fields ${identity}`);
      const source = sources.get(evidence.paragraphId), key = `${evidence.paragraphId}/${evidence.excerpt}`;
      requireValue(source && source.chapter.id === evidence.chapterId && evidence.originalRevision === source.paragraph.revision
        && evidence.originalSha256 === timelineHash(source.paragraph.original) && text(evidence.excerpt, 6000)
        && source.paragraph.original.includes(evidence.excerpt) && !seen.has(key), `source binding ${identity}`);
      seen.add(key);
    }
  };
  for (const event of input.events) {
    requireValue(only(event, ['id', 'title', 'summary', 'year', 'sortOrder', 'precision', 'sourceDate', 'phase', 'evidence', 'variants', 'notes']), 'event fields');
    requireValue(typeof event.id === 'string' && event.id.startsWith(`${input.personId}-`)
      && /^[a-z0-9][a-z0-9-]{0,119}$/.test(event.id) && !ids.has(event.id), 'stable event identity');
    ids.add(event.id);
    requireValue(text(event.title, 100) && text(event.summary, 2000) && text(event.sourceDate, 300)
      && year(event.year) && Number.isSafeInteger(event.sortOrder) && event.sortOrder >= 0
      && ['year', 'month', 'day'].includes(event.precision) && timelinePhases.includes(event.phase) && notes(event.notes), `event metadata ${event.id}`);
    requireValue(event.year > previousYear || (event.year === previousYear && event.sortOrder > previousOrder), `chronological order ${event.id}`);
    previousYear = event.year; previousOrder = event.sortOrder;
    evidenceList(event.evidence, event.id);
    if (event.variants !== undefined) {
      requireValue(Array.isArray(event.variants) && event.variants.length > 0 && event.variants.length <= 10, `variants ${event.id}`);
      for (const variant of event.variants) {
        requireValue(only(variant, ['label', 'sourceDate', 'year', 'summary', 'notes', 'evidence']) && text(variant.label, 100)
          && text(variant.sourceDate, 300) && (variant.year === undefined || year(variant.year))
          && (variant.summary === undefined || text(variant.summary, 2000)) && notes(variant.notes), `variant metadata ${event.id}`);
        evidenceList(variant.evidence, event.id);
      }
    }
  }
  return input;
}

export function loadPersonTimelines(library = loadLibrary()) {
  const documents = readdirSync(timelinesRoot).filter(name => name.endsWith('.json') && name !== 'catalog.json')
    .sort().map(file => {
      const document = validatePersonTimeline(JSON.parse(readFileSync(new URL(file, timelinesRoot), 'utf8')), library);
      requireValue(file === `${document.personId}.json`, 'document filename'); return document;
    });
  requireValue(documents.length > 0 && new Set(documents.map(d => d.personId)).size === documents.length, 'unique person documents');
  return documents;
}

export function buildTimelineSummary(documents = loadPersonTimelines()) {
  return { schemaVersion: 1, scope: 'current-archive', people: documents.map(d => ({ personId: d.personId,
    eventCount: d.events.length, eventIds: d.events.map(e => e.id) })) };
}
