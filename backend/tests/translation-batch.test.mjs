import assert from 'node:assert/strict';
import test from 'node:test';
import { validateTranslationBatch } from '../src/translation-batch.mjs';

import { fixtureBatch } from './fixtures/translation-batch.mjs';

test('a complete aligned AI draft batch retains original identity and review notes', () => {
  const value = validateTranslationBatch(fixtureBatch());
  assert.equal(value.entries.length, 76);
  assert.ok(value.entries.every(entry => entry.metadata.origin === 'ai' && entry.metadata.humanReviewed === false));
  assert.deepEqual(value.entries[0].metadata.reviewNotes, ['测试疑点，尚未人工校订。']);
  assert.equal(value.entries[0].metadata.source.originalSha256, value.entries[0].originalSha256);
  const reorderedKeys = Object.fromEntries(Object.entries(fixtureBatch()).reverse());
  assert.equal(validateTranslationBatch(reorderedKeys).digest, value.digest);
});

test('missing, duplicated, reordered or mismatched source paragraphs are rejected before DB writes', () => {
  for (const mutate of [
    batch => { batch.id = ['test-chunqiu-ai-v1']; },
    batch => batch.entries.pop(),
    batch => { batch.entries[1] = batch.entries[0]; },
    batch => batch.entries.reverse(),
    batch => { batch.entries[0].originalRevision++; },
    batch => { batch.entries[0].originalSha256 = '0'.repeat(64); },
    batch => { batch.chapterIds[0] = 'old-v001'; },
    batch => { batch.entries[0].text = ' '; },
  ]) {
    const batch = fixtureBatch(); mutate(batch);
    assert.throws(() => validateTranslationBatch(batch), /Invalid translation batch/);
  }
});

test('AI imports cannot claim human review or publish content through batch metadata', () => {
  for (const mutate of [
    batch => { batch.status = 'published'; },
    batch => { batch.status = 'reviewed'; },
    batch => { batch.generation.humanReviewed = true; },
    batch => { batch.translator = ''; },
    batch => { batch.entries[0].reviewNotes = 'unstructured notes'; },
  ]) {
    const batch = fixtureBatch(); mutate(batch);
    assert.throws(() => validateTranslationBatch(batch), /Invalid translation batch/);
  }
});
