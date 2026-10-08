-- Display references only. Canonical originals and translation versions are never changed.
CREATE TABLE IF NOT EXISTS public.person_passage_index (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  schema_version integer NOT NULL CHECK (schema_version = 1),
  scope text NOT NULL CHECK (scope = 'current-archive'),
  book_count integer NOT NULL CHECK (book_count >= 0),
  chapter_count integer NOT NULL CHECK (chapter_count >= 0),
  paragraph_count integer NOT NULL CHECK (paragraph_count >= 0),
  digest text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$')
);
CREATE TABLE IF NOT EXISTS public.passage_people (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]*$'),
  name text NOT NULL CHECK (length(trim(name)) > 0)
);
CREATE TABLE IF NOT EXISTS public.passages (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]*$'),
  chapter_id text NOT NULL REFERENCES public.chapters(id),
  title text NOT NULL CHECK (length(trim(title)) > 0)
);
CREATE TABLE IF NOT EXISTS public.passage_spans (
  passage_id text NOT NULL REFERENCES public.passages(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position > 0),
  paragraph_id text NOT NULL,
  original_revision integer NOT NULL CHECK (original_revision > 0),
  original_sha256 text NOT NULL CHECK (original_sha256 ~ '^[a-f0-9]{64}$'),
  start_offset integer NOT NULL CHECK (start_offset >= 0),
  end_offset integer NOT NULL CHECK (end_offset > start_offset),
  PRIMARY KEY (passage_id, position),
  UNIQUE (passage_id, paragraph_id, start_offset, end_offset),
  FOREIGN KEY (paragraph_id, original_revision) REFERENCES public.paragraph_revisions(paragraph_id, revision)
);
CREATE TABLE IF NOT EXISTS public.person_passages (
  person_id text NOT NULL REFERENCES public.passage_people(id),
  passage_id text NOT NULL REFERENCES public.passages(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('biography', 'record', 'mention')),
  PRIMARY KEY (person_id, passage_id)
);
CREATE INDEX IF NOT EXISTS passages_chapter_idx ON public.passages(chapter_id);
CREATE INDEX IF NOT EXISTS passage_spans_paragraph_idx ON public.passage_spans(paragraph_id, original_revision);
CREATE INDEX IF NOT EXISTS person_passages_passage_idx ON public.person_passages(passage_id);

REVOKE ALL ON public.person_passage_index, public.passage_people, public.passages,
  public.passage_spans, public.person_passages FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'history_reader') THEN
    GRANT SELECT ON public.person_passage_index, public.passage_people, public.passages,
      public.passage_spans, public.person_passages TO history_reader;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'history_editor') THEN
    REVOKE ALL ON public.person_passage_index, public.passage_people, public.passages,
      public.passage_spans, public.person_passages FROM history_editor;
  END IF;
END $$;
