-- Independently published supplements; originals and full translations stay immutable.
CREATE TABLE IF NOT EXISTS public.sentence_translations (
  id text PRIMARY KEY,
  paragraph_id text NOT NULL,
  original_revision integer NOT NULL CHECK (original_revision > 0),
  original_sha256 text NOT NULL CHECK (original_sha256 ~ '^[a-f0-9]{64}$'),
  original_start integer NOT NULL CHECK (original_start >= 0),
  original_end integer NOT NULL CHECK (original_end > original_start),
  parent_translation_id bigint NOT NULL REFERENCES public.translations(id),
  parent_translation_version integer NOT NULL CHECK (parent_translation_version > 0),
  parent_translation_sha256 text NOT NULL CHECK (parent_translation_sha256 ~ '^[a-f0-9]{64}$'),
  version integer NOT NULL CHECK (version > 0),
  text text NOT NULL CHECK (length(trim(text)) > 0),
  status text NOT NULL CHECK (status IN ('draft', 'published')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (paragraph_id, original_revision) REFERENCES public.paragraph_revisions(paragraph_id, revision),
  UNIQUE (paragraph_id, original_revision, original_start, original_end, parent_translation_id, version)
);
CREATE INDEX IF NOT EXISTS sentence_translations_paragraph_idx
  ON public.sentence_translations(paragraph_id, parent_translation_id, original_start, version DESC);
REVOKE ALL ON public.sentence_translations FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='history_reader') THEN
    GRANT SELECT ON public.sentence_translations TO history_reader;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='history_editor') THEN
    REVOKE ALL ON public.sentence_translations FROM history_editor;
  END IF;
END $$;
