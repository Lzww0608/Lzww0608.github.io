export interface PassagePageBaseline {
  target: string;
  source: 'api' | 'archive';
  resultSetRevision: string;
}

export function matchesPassagePageBaseline(
  baseline: PassagePageBaseline | null,
  target: string,
  source: PassagePageBaseline['source'],
  resultSetRevision: string,
): boolean {
  return baseline?.target === target && baseline.source === source && baseline.resultSetRevision === resultSetRevision;
}
