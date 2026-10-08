// Both complete chapters and person passages expose the same current paragraph model.
// The calling query supplies p (paragraph), r (current original) and t (published translation).
export const publicParagraphJson = `jsonb_build_object('id', p.id, 'position', p.position, 'revision', r.revision, 'original', r.original,
  'translation', CASE WHEN t.id IS NULL THEN NULL ELSE jsonb_build_object('id', t.id::text, 'text', t.text, 'language', t.language, 'version', t.version, 'translator', t.translator,
    'origin',coalesce(t.metadata->>'origin','human'),
    'reviewStatus',CASE WHEN t.metadata->>'origin'='ai' AND t.metadata->'humanReviewed' IS DISTINCT FROM 'true'::jsonb THEN 'pending' ELSE coalesce(t.metadata->>'reviewStatus','reviewed') END,
    'reviewNotes',coalesce(t.metadata->'reviewNotes','[]'::jsonb)) END)`;
export const latestPublishedTranslationJoin = `LEFT JOIN LATERAL (SELECT * FROM public.translations t
  WHERE t.paragraph_id=p.id AND t.original_revision=p.current_revision AND t.language='zh-Hans' AND t.status='published'
  ORDER BY t.version DESC LIMIT 1) t ON true`;
