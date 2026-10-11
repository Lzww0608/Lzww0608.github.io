-- Independent display index. No original, translation or review history is edited.
CREATE TABLE IF NOT EXISTS public.person_timelines (
  person_id text PRIMARY KEY REFERENCES public.passage_people(id),
  document jsonb NOT NULL CHECK ((jsonb_typeof(document) = 'object'
    AND document->>'schemaVersion' = '1' AND document->>'scope' = 'current-archive'
    AND document->>'personId' = person_id AND jsonb_typeof(document->'events') = 'array'
    AND jsonb_array_length(document->'events') BETWEEN 1 AND 500) IS TRUE),
  digest text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON public.person_timelines FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'history_reader') THEN
    GRANT SELECT ON public.person_timelines TO history_reader;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'history_editor') THEN
    REVOKE ALL ON public.person_timelines FROM history_editor;
  END IF;
END $$;
