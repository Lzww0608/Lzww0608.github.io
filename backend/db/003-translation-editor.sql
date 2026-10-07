-- Only this function can append website-owner revisions. Originals and prior
-- translation versions are never updated. Run creation and grants in one transaction.
CREATE OR REPLACE FUNCTION public.revise_published_translation(
  requested_paragraph_id text,
  expected_original_revision integer,
  expected_translation_id bigint,
  replacement_text text,
  editor_name text,
  requested_review_notes jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  current_original_revision integer;
  is_visible boolean;
  previous_translation public.translations%ROWTYPE;
  inserted_translation public.translations%ROWTYPE;
  next_version integer;
  provenance jsonb;
BEGIN
  -- Validate here as well as in HTTP code: the database role can invoke the
  -- function directly but cannot bypass these constraints.
  IF requested_paragraph_id IS NULL
     OR char_length(requested_paragraph_id) > 160
     OR requested_paragraph_id !~ '^[a-z0-9][a-z0-9_-]*$'
     OR expected_original_revision IS NULL OR expected_original_revision < 1
     OR expected_translation_id IS NULL OR expected_translation_id < 1
     OR replacement_text IS NULL OR char_length(replacement_text) > 20000
     OR replacement_text !~ '[^[:space:]]'
     OR editor_name IS NULL OR char_length(editor_name) > 80
     OR editor_name !~ '[^[:space:]]' OR editor_name ~ '[[:cntrl:]]'
     OR requested_review_notes IS NULL
     OR jsonb_typeof(requested_review_notes) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Invalid translation revision input.';
  END IF;
  IF jsonb_array_length(requested_review_notes) > 20 OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(requested_review_notes) AS item(value)
    WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'string'
       OR char_length(item.value #>> '{}') > 2000
       OR (item.value #>> '{}') !~ '[^[:space:]]'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Invalid translation review notes.';
  END IF;

  -- All authors of a revision serialize on the original paragraph. SHARE locks
  -- keep publication visibility fixed until this statement/transaction finishes.
  SELECT p.current_revision, c.published AND b.published
    INTO current_original_revision, is_visible
    FROM public.paragraphs AS p
    JOIN public.chapters AS c ON c.id = p.chapter_id
    JOIN public.editions AS e ON e.id = c.edition_id
    JOIN public.books AS b ON b.id = e.book_id
    WHERE p.id = requested_paragraph_id
    FOR UPDATE OF p FOR SHARE OF c, b;
  IF NOT FOUND OR NOT is_visible THEN
    RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Published paragraph not found.';
  END IF;
  IF current_original_revision <> expected_original_revision THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'The original has changed. Reload before editing.';
  END IF;

  SELECT t.* INTO previous_translation
    FROM public.translations AS t
    WHERE t.paragraph_id = requested_paragraph_id
      AND t.original_revision = current_original_revision
      AND t.language = 'zh-Hans' AND t.status = 'published'
    ORDER BY t.version DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Published translation not found.';
  END IF;
  IF previous_translation.id <> expected_translation_id THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'The translation has changed. Reload before editing.';
  END IF;
  SELECT coalesce(max(t.version), 0) + 1 INTO next_version
    FROM public.translations AS t
    WHERE t.paragraph_id = requested_paragraph_id
      AND t.original_revision = current_original_revision AND t.language = 'zh-Hans';

  provenance := jsonb_build_object(
    'origin', 'human',
    'reviewStatus', 'owner-edited',
    'basedOnTranslationId', previous_translation.id::text,
    'sourceOrigin', coalesce(previous_translation.metadata->>'origin', 'human'),
    'reviewNotes', requested_review_notes,
    'professionalReview', false
  );
  IF previous_translation.metadata->>'origin' = 'ai' THEN
    provenance := provenance || jsonb_build_object('aiSourceTranslationId', previous_translation.id::text);
  ELSIF previous_translation.metadata ? 'aiSourceTranslationId' THEN
    provenance := provenance || jsonb_build_object('aiSourceTranslationId', previous_translation.metadata->>'aiSourceTranslationId');
  END IF;
  INSERT INTO public.translations
    (paragraph_id, original_revision, language, version, text, translator, status, metadata)
    VALUES (requested_paragraph_id, current_original_revision, 'zh-Hans', next_version,
      replacement_text, editor_name, 'published', provenance)
    RETURNING * INTO inserted_translation;

  RETURN jsonb_build_object('paragraphId', requested_paragraph_id, 'translation', jsonb_build_object(
    'id', inserted_translation.id::text,
    'text', inserted_translation.text,
    'language', inserted_translation.language,
    'version', inserted_translation.version,
    'translator', inserted_translation.translator,
    'origin', 'human',
    'reviewStatus', 'owner-edited',
    'reviewNotes', requested_review_notes
  ));
END;
$function$;
REVOKE ALL ON FUNCTION public.revise_published_translation(text, integer, bigint, text, text, jsonb) FROM PUBLIC;
