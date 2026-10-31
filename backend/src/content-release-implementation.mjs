// Shared by the isolated verifier and transaction owner; no public route imports this module.
import { readFileSync, readdirSync } from 'node:fs';
import { digest, sha256 } from './backup-archive.mjs';
import { validateMilitaryTopic } from '../../content/military-people.mjs';

const backendRoot = new URL('../', import.meta.url);

export function validateMilitaryReleaseQualification(content) {
  const topic = JSON.parse(readFileSync(new URL('../content/five-dynasties/military-people.json', backendRoot), 'utf8'));
  return validateMilitaryTopic(topic, content.library, content.people, content.passageIndex);
}

// The exact validators and public source registries used during isolated
// verification must still be present at formal publication.
export function releaseImplementationFingerprint() {
  const paths = ['scripts/release-content-batch.mjs', 'src/content-release-batch.mjs', 'src/content-release-implementation.mjs', 'src/content-release-timeline-guards.mjs', 'src/content-release-verification.mjs', 'scripts/import-library.mjs',
    'scripts/import-translations.mjs', 'scripts/publish-ai-batch.mjs', 'scripts/apply-review-corrections.mjs', 'scripts/import-sentence-translations.mjs',
    'scripts/import-person-passages.mjs', 'scripts/import-person-timelines.mjs', 'scripts/import-review-items.mjs', 'src/translation-batch.mjs', 'src/owner-reviews.mjs',
    'src/backup-archive.mjs', '../content/person-passages.mjs', '../scripts/index-person-passages.mjs', '../content/person-timelines.mjs', '../content/military-people.mjs', '../content/sentence-translations.mjs',
    '../content/owner-review-subjects.json', '../frontend/src/sentence-alignment.ts',
    ...['001-initial', '002-translation-metadata', '003-translation-editor', '004-person-passages', '005-sentence-translations', '006-owner-reviews', '007-person-timelines', '008-owner-review-subjects'].map(p => `db/${p}.sql`)];
  // IDs/names alone do not freeze aliases, biography wording or graph claims.
  // Source JSON includes the military topic; frozen passage data lives in the release fingerprint.
  for (const directory of ['../content/five-dynasties', '../content/southern-northern', '../content/person-relationships']) {
    for (const file of readdirSync(new URL(`${directory}/`, backendRoot)).filter(f => f.endsWith('.json')).sort()) paths.push(`${directory}/${file}`);
  }
  paths.push('../content/person-passages/rules.json', '../content/person-passages/verified-attributions.json', '../content/person-passages/chronology-subjects.json',
    '../frontend/src/person-catalog.ts', '../frontend/src/types.ts', '../frontend/src/relationships.ts');
  const files = Object.fromEntries(paths.map(path => [path, sha256(readFileSync(new URL(path, backendRoot)))]));
  return { files, sha256: digest(files) };
}
