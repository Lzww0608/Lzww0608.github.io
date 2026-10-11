import baixiang from '../../content/event-comparisons/baixiang.json' with { type: 'json' };
import { parseEventComparisonDocument } from './event-comparison-schema.ts';

export const eventComparisons = [parseEventComparisonDocument(baixiang)];

export function comparisonsForPerson(personId: string) {
  return eventComparisons.filter(document => document.personIds.includes(personId));
}
