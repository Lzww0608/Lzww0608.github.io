import baixiang from '../../content/event-comparisons/baixiang.json' with { type: 'json' };
import huliu from '../../content/event-comparisons/huliu.json' with { type: 'json' };
import jinyang from '../../content/event-comparisons/jinyang.json' with { type: 'json' };
import { parseEventComparisonDocument } from './event-comparison-schema.ts';

// Register each public topic explicitly. This keeps unrelated archive chapters
// out of the initial bundle while reusing the same reader and safe routes.
export const eventComparisons = [parseEventComparisonDocument(baixiang, 'baixiang'), parseEventComparisonDocument(huliu, 'huliu'),
  parseEventComparisonDocument(jinyang, 'jinyang')];

export function comparisonsForPerson(personId: string) {
  return eventComparisons.filter(document => document.personIds.includes(personId));
}
