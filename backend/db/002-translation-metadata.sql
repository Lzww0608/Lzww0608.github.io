-- Draft provenance is separate from originals and from the public API payload.
ALTER TABLE translations ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(metadata) = 'object');
CREATE INDEX IF NOT EXISTS translations_batch_idx ON translations ((metadata->>'batchId'))
  WHERE metadata ? 'batchId';
