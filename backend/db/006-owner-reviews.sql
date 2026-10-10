-- Private findings. Neither the public reader nor the restricted editor has
-- direct table/view access; only the three narrow editor functions are granted.
CREATE TABLE IF NOT EXISTS public.owner_review_subjects (
  id text PRIMARY KEY CHECK (id IN ('li-keyong','li-cunxu','zhu-wen','chai-rong')),
  name text NOT NULL
);
INSERT INTO public.owner_review_subjects(id,name) VALUES
  ('li-keyong','李克用'),('li-cunxu','李存勖'),('zhu-wen','朱温'),('chai-rong','柴荣')
  ON CONFLICT (id) DO NOTHING;
CREATE TABLE IF NOT EXISTS public.owner_review_batches (
  id text PRIMARY KEY,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  item_count integer NOT NULL CHECK (item_count >= 0),
  imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.owner_review_items (
  id text PRIMARY KEY,
  person_id text NOT NULL REFERENCES public.owner_review_subjects(id),
  book_id text NOT NULL REFERENCES public.books(id),
  chapter_id text NOT NULL REFERENCES public.chapters(id),
  paragraph_id text NOT NULL REFERENCES public.paragraphs(id),
  category text NOT NULL CHECK (category IN ('translation','association','relationship','source-note')),
  status text NOT NULL CHECK (status IN ('open','resolved','retained','checked')),
  severity text NOT NULL CHECK (severity IN ('info','warning','error')),
  title text NOT NULL,
  detail text NOT NULL,
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence)='array'),
  original_revision integer NOT NULL CHECK (original_revision > 0),
  original_sha256 text NOT NULL CHECK (original_sha256 ~ '^[a-f0-9]{64}$'),
  translation_id bigint REFERENCES public.translations(id),
  translation_version integer,
  translation_sha256 text,
  checked_at timestamptz NOT NULL,
  resolution text NOT NULL DEFAULT '',
  batch_id text NOT NULL REFERENCES public.owner_review_batches(id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((translation_id IS NULL AND translation_version IS NULL AND translation_sha256 IS NULL)
    OR (translation_id IS NOT NULL AND translation_version > 0 AND translation_sha256 ~ '^[a-f0-9]{64}$')),
  CHECK (category <> 'translation' OR translation_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS owner_review_filter_idx
  ON public.owner_review_items(person_id,book_id,status,category,id);
CREATE TABLE IF NOT EXISTS public.owner_review_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id text NOT NULL REFERENCES public.owner_review_items(id),
  item_version integer NOT NULL,
  actor text NOT NULL CHECK (actor IN ('owner','batch')),
  previous_status text,
  status text NOT NULL,
  resolution text NOT NULL,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE VIEW public.owner_review_records AS
SELECT i.*, s.name AS person_name, b.title AS book_title, c.title AS chapter_title,
  p.position AS paragraph_position, p.current_revision,
  r.original AS current_original,
  encode(sha256(convert_to(r.original,'UTF8')),'hex') AS current_original_sha256,
  t.id::text AS current_translation_id, t.version AS current_translation_version,
  t.text AS current_translation, t.metadata AS current_translation_metadata,
  t.translator AS current_translation_translator,
  encode(sha256(convert_to(t.text,'UTF8')),'hex') AS current_translation_sha256,
  coalesce(c.published AND b.published AND p.chapter_id=i.chapter_id AND b.id=i.book_id
    AND p.current_revision=i.original_revision
    AND encode(sha256(convert_to(r.original,'UTF8')),'hex')=i.original_sha256
    AND (i.translation_id IS NULL OR (t.id=i.translation_id AND t.version=i.translation_version
      AND encode(sha256(convert_to(t.text,'UTF8')),'hex')=i.translation_sha256))
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(i.evidence) AS ev(value)
      LEFT JOIN public.paragraphs ep ON ep.id=ev.value->>'paragraphId'
      LEFT JOIN public.paragraph_revisions er ON er.paragraph_id=ep.id AND er.revision=ep.current_revision
      LEFT JOIN public.chapters ec ON ec.id=ep.chapter_id
      LEFT JOIN public.editions ee ON ee.id=ec.edition_id
      LEFT JOIN public.books eb ON eb.id=ee.book_id
      WHERE ep.id IS NULL OR ec.published IS NOT TRUE OR eb.published IS NOT TRUE
        OR ep.chapter_id IS DISTINCT FROM ev.value->>'chapterId'
        OR ep.current_revision IS DISTINCT FROM (ev.value->>'originalRevision')::integer
        OR encode(sha256(convert_to(er.original,'UTF8')),'hex') IS DISTINCT FROM ev.value->>'originalSha256'
        OR strpos(er.original,ev.value->>'excerpt')=0
    ),false) AS current_binding
FROM public.owner_review_items i
JOIN public.owner_review_subjects s ON s.id=i.person_id
JOIN public.paragraphs p ON p.id=i.paragraph_id
JOIN public.paragraph_revisions r ON r.paragraph_id=p.id AND r.revision=p.current_revision
JOIN public.chapters c ON c.id=p.chapter_id
JOIN public.editions e ON e.id=c.edition_id
JOIN public.books b ON b.id=e.book_id
LEFT JOIN LATERAL (
  SELECT tr.* FROM public.translations tr WHERE tr.paragraph_id=p.id
    AND tr.original_revision=p.current_revision AND tr.language='zh-Hans' AND tr.status='published'
  ORDER BY tr.version DESC LIMIT 1
) t ON true;

CREATE OR REPLACE FUNCTION public.owner_review_json(record public.owner_review_records)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $fn$
SELECT jsonb_build_object(
  'id',record.id,'personId',record.person_id,'personName',record.person_name,
  'bookId',record.book_id,'bookTitle',record.book_title,'chapterId',record.chapter_id,
  'chapterTitle',record.chapter_title,'paragraphId',record.paragraph_id,'paragraphPosition',record.paragraph_position,
  'category',record.category,'status',record.status,'severity',record.severity,'title',record.title,
  'detail',record.detail,'evidence',record.evidence,'originalRevision',record.original_revision,
  'originalSha256',record.original_sha256,'translationId',record.translation_id::text,
  'translationVersion',record.translation_version,'translationSha256',record.translation_sha256,
  'checkedAt',record.checked_at,'resolution',record.resolution,'batchId',record.batch_id,
  'version',record.version,'currentBinding',record.current_binding
);
$fn$;

CREATE OR REPLACE FUNCTION public.owner_review_list(
  requested_person text, requested_book text, requested_status text, requested_category text,
  requested_limit integer, requested_offset integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE result jsonb;
BEGIN
  IF requested_person IS NOT NULL AND requested_person NOT IN ('li-keyong','li-cunxu','zhu-wen','chai-rong')
    OR requested_book IS NOT NULL AND (char_length(requested_book)>160 OR requested_book !~ '^[a-z0-9][a-z0-9_-]*$')
    OR requested_status IS NOT NULL AND requested_status NOT IN ('open','resolved','retained','checked','stale')
    OR requested_category IS NOT NULL AND requested_category NOT IN ('translation','association','relationship','source-note')
    OR requested_limit IS NULL OR requested_limit<1 OR requested_limit>100
    OR requested_offset IS NULL OR requested_offset<0 OR requested_offset>1000000 THEN
    RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='Invalid review filters.';
  END IF;
  WITH base AS MATERIALIZED (
    SELECT r FROM public.owner_review_records r
    WHERE (requested_person IS NULL OR r.person_id=requested_person)
      AND (requested_book IS NULL OR r.book_id=requested_book)
      AND (requested_category IS NULL OR r.category=requested_category)
  ), filtered AS MATERIALIZED (
    SELECT r FROM base WHERE requested_status IS NULL
      OR (requested_status='stale' AND NOT (r).current_binding)
      OR (requested_status<>'stale' AND (r).status=requested_status)
  ), page AS (
    SELECT r FROM filtered ORDER BY (r).id LIMIT requested_limit OFFSET requested_offset
  ) SELECT jsonb_build_object('schemaVersion',1,
    'subjects',(SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) ORDER BY s.id) FROM public.owner_review_subjects s),
    'total',(SELECT count(*) FROM filtered),
    'summary',(SELECT jsonb_build_object(
      'open',count(*) FILTER (WHERE (r).status='open'),
      'resolved',count(*) FILTER (WHERE (r).status='resolved'),
      'retained',count(*) FILTER (WHERE (r).status='retained'),
      'checked',count(*) FILTER (WHERE (r).status='checked'),
      'stale',count(*) FILTER (WHERE NOT (r).current_binding)) FROM base),
    'items',coalesce((SELECT jsonb_agg(public.owner_review_json(r) ORDER BY (r).id) FROM page),'[]'::jsonb),
    'nextOffset',CASE WHEN requested_offset+requested_limit<(SELECT count(*) FROM filtered)
      THEN requested_offset+requested_limit ELSE NULL END,
    'resultSetRevision',encode(sha256(convert_to(jsonb_build_object(
      'person',requested_person,'book',requested_book,'status',requested_status,'category',requested_category,
      'items',coalesce((SELECT jsonb_agg(jsonb_build_array((r).id,(r).version,(r).current_binding,
        (r).current_revision,(r).current_original_sha256,(r).current_translation_id,
        (r).current_translation_sha256) ORDER BY (r).id) FROM filtered),'[]'::jsonb)
    )::text,'UTF8')),'hex')) INTO result;
  RETURN result;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.owner_review_detail(requested_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
SELECT jsonb_build_object('schemaVersion',1,'item',public.owner_review_json(r),
  'paragraph',jsonb_build_object('id',r.paragraph_id,'position',r.paragraph_position,
    'revision',r.current_revision,'original',r.current_original,'translation',
  CASE WHEN r.current_translation_id IS NULL THEN NULL ELSE jsonb_build_object(
    'id',r.current_translation_id,'version',r.current_translation_version,'text',r.current_translation,
    'language','zh-Hans','translator',r.current_translation_translator,
    'origin',r.current_translation_metadata->>'origin','reviewStatus',r.current_translation_metadata->>'reviewStatus',
    'sha256',r.current_translation_sha256,'reviewNotes',coalesce(r.current_translation_metadata->'reviewNotes','[]'::jsonb)) END))
FROM public.owner_review_records r WHERE r.id=requested_id;
$fn$;

CREATE OR REPLACE FUNCTION public.owner_review_set_status(
  requested_id text, expected_version integer, requested_status text, requested_resolution text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE old_item public.owner_review_items%ROWTYPE; binding boolean;
BEGIN
  IF requested_id IS NULL OR char_length(requested_id)>160 OR requested_id !~ '^[a-z0-9][a-z0-9_-]*$'
    OR expected_version IS NULL OR expected_version<1
    OR requested_status IS NULL OR requested_status NOT IN ('open','resolved','retained','checked')
    OR requested_resolution IS NULL OR char_length(requested_resolution)>4000
    OR requested_resolution !~ '[^[:space:]]' THEN
    RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='Invalid review status update.';
  END IF;
  SELECT * INTO old_item FROM public.owner_review_items WHERE id=requested_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PT404',MESSAGE='Review item not found.'; END IF;
  IF old_item.version<>expected_version THEN
    RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Review item changed.';
  END IF;
  -- Serialize against owner translation/original updates and keep evidence fixed.
  PERFORM p.id FROM public.paragraphs p WHERE p.id=old_item.paragraph_id
    OR p.id IN (SELECT ev.value->>'paragraphId' FROM jsonb_array_elements(old_item.evidence) ev(value))
    ORDER BY p.id FOR SHARE;
  SELECT r.current_binding INTO binding FROM public.owner_review_records r WHERE r.id=requested_id;
  IF binding IS DISTINCT FROM true AND requested_status<>'open' THEN
    RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='Review source binding changed.';
  END IF;
  UPDATE public.owner_review_items SET status=requested_status,resolution=requested_resolution,
    version=version+1,updated_at=clock_timestamp() WHERE id=requested_id;
  INSERT INTO public.owner_review_events(item_id,item_version,actor,previous_status,status,resolution,record)
    SELECT id,version,'owner',old_item.status,status,resolution,to_jsonb(i)
    FROM public.owner_review_items i WHERE id=requested_id;
  RETURN jsonb_build_object('item',public.owner_review_detail(requested_id)->'item');
END;
$fn$;

REVOKE ALL ON public.owner_review_subjects,public.owner_review_batches,public.owner_review_items,
  public.owner_review_events,public.owner_review_records FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.owner_review_events_id_seq FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owner_review_json(public.owner_review_records),
  public.owner_review_list(text,text,text,text,integer,integer),public.owner_review_detail(text),
  public.owner_review_set_status(text,integer,text,text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='history_reader') THEN
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM history_reader;
    REVOKE ALL ON public.owner_review_subjects,public.owner_review_batches,public.owner_review_items,
      public.owner_review_events,public.owner_review_records FROM history_reader;
    REVOKE ALL ON SEQUENCE public.owner_review_events_id_seq FROM history_reader;
    REVOKE ALL ON FUNCTION public.owner_review_json(public.owner_review_records),
      public.owner_review_list(text,text,text,text,integer,integer),public.owner_review_detail(text),
      public.owner_review_set_status(text,integer,text,text) FROM history_reader;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='history_editor') THEN
    REVOKE ALL ON public.owner_review_subjects,public.owner_review_batches,public.owner_review_items,
      public.owner_review_events,public.owner_review_records FROM history_editor;
    REVOKE ALL ON SEQUENCE public.owner_review_events_id_seq FROM history_editor;
    REVOKE ALL ON FUNCTION public.owner_review_json(public.owner_review_records) FROM history_editor;
    GRANT EXECUTE ON FUNCTION public.owner_review_list(text,text,text,text,integer,integer),
      public.owner_review_detail(text),public.owner_review_set_status(text,integer,text,text) TO history_editor;
  END IF;
END $$;
