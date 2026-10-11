import baixiangLinks from '../../content/event-timeline-links/baixiang.json' with { type: 'json' };
import huliuLinks from '../../content/event-timeline-links/huliu.json' with { type: 'json' };
import { eventComparisons } from './event-comparison-data.ts';
import { parseEventTimelineLinksDocument } from './event-timeline-links-schema.ts';

export const eventTimelineLinks = [baixiangLinks, huliuLinks].map(registry => {
  const comparison = eventComparisons.find(document => document.id === registry.comparisonId);
  if (!comparison) throw new Error('Unregistered event comparison links');
  return parseEventTimelineLinksDocument(registry, comparison);
});
export { timelineEventIdentity, resolveEventTimelineLinks } from './event-timeline-links-schema.ts';
export type { EventTimelineLinksResponse, ResolvedEventTimelineLink } from './event-timeline-links-schema.ts';
