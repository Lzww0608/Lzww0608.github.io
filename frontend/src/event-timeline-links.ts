import baixiangLinks from '../../content/event-timeline-links/baixiang.json' with { type: 'json' };
import { eventComparisons } from './event-comparison-data.ts';
import { parseEventTimelineLinksDocument } from './event-timeline-links-schema.ts';

export const eventTimelineLinks = [parseEventTimelineLinksDocument(baixiangLinks, eventComparisons.find(document => document.id === 'baixiang')!)];
export { timelineEventIdentity, resolveEventTimelineLinks } from './event-timeline-links-schema.ts';
export type { EventTimelineLinksResponse, ResolvedEventTimelineLink } from './event-timeline-links-schema.ts';
