CREATE TABLE IF NOT EXISTS books (
  id text PRIMARY KEY,
  title text NOT NULL,
  author text NOT NULL,
  description text NOT NULL,
  source_url text NOT NULL,
  published boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS editions (
  id text PRIMARY KEY,
  book_id text NOT NULL REFERENCES books(id),
  label text NOT NULL,
  source_note text NOT NULL
);
CREATE TABLE IF NOT EXISTS chapters (
  id text PRIMARY KEY,
  edition_id text NOT NULL REFERENCES editions(id),
  position integer NOT NULL CHECK (position > 0),
  title text NOT NULL,
  source_url text NOT NULL,
  notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  scope text NOT NULL DEFAULT 'excerpt' CHECK (scope IN ('excerpt', 'full')),
  published boolean NOT NULL DEFAULT false,
  UNIQUE (edition_id, position)
);
CREATE TABLE IF NOT EXISTS paragraphs (
  id text PRIMARY KEY,
  chapter_id text NOT NULL REFERENCES chapters(id),
  position integer NOT NULL CHECK (position > 0),
  current_revision integer NOT NULL CHECK (current_revision > 0),
  UNIQUE (chapter_id, position)
);
CREATE TABLE IF NOT EXISTS paragraph_revisions (
  paragraph_id text NOT NULL REFERENCES paragraphs(id),
  revision integer NOT NULL CHECK (revision > 0),
  original text NOT NULL CHECK (length(trim(original)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (paragraph_id, revision)
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paragraphs_current_revision_fk') THEN
    ALTER TABLE paragraphs ADD CONSTRAINT paragraphs_current_revision_fk
      FOREIGN KEY (id, current_revision) REFERENCES paragraph_revisions(paragraph_id, revision)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS translations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  paragraph_id text NOT NULL,
  original_revision integer NOT NULL,
  language text NOT NULL DEFAULT 'zh-Hans',
  version integer NOT NULL CHECK (version > 0),
  text text NOT NULL CHECK (length(trim(text)) > 0),
  translator text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'reviewed', 'published')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (paragraph_id, original_revision) REFERENCES paragraph_revisions(paragraph_id, revision),
  UNIQUE (paragraph_id, original_revision, language, version)
);
CREATE INDEX IF NOT EXISTS translations_public_idx ON translations (paragraph_id, original_revision, language, version DESC) WHERE status = 'published';
