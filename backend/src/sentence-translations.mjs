import { latestPublishedTranslationJoin } from './public-paragraph-sql.mjs';

export function createSentenceTranslationsRepository(pool) {
  return {
    async sentenceTranslations(chapterId) {
      const { rows } = await pool.query(`SELECT c.id AS "chapterId",
        COALESCE((SELECT jsonb_agg(record.value ORDER BY record.position, record.original_start)
          FROM (SELECT DISTINCT ON (p.id,s.original_start,s.original_end) p.position,s.original_start,
            jsonb_build_object('id',s.id,'paragraphId',p.id,'originalRevision',s.original_revision,
            'originalSha256',s.original_sha256,'originalStart',s.original_start,'originalEnd',s.original_end,
            'parentTranslationId',s.parent_translation_id::text,'parentTranslationVersion',s.parent_translation_version,
            'parentTranslationSha256',s.parent_translation_sha256,'version',s.version,'text',s.text,'textSha256',encode(sha256(convert_to(s.text,'UTF8')),'hex'),
            'reviewNotes',COALESCE(s.metadata->'reviewNotes','[]'::jsonb),'origin',s.metadata->>'origin','humanReviewed',s.metadata->'humanReviewed') AS value
          FROM public.paragraphs p
          JOIN public.paragraph_revisions r ON r.paragraph_id=p.id AND r.revision=p.current_revision
          ${latestPublishedTranslationJoin}
          JOIN public.sentence_translations s ON s.paragraph_id=p.id AND s.original_revision=p.current_revision
          WHERE p.chapter_id=c.id AND s.status='published' AND s.parent_translation_id=t.id
            AND s.parent_translation_version=t.version
            AND s.original_sha256=encode(sha256(convert_to(r.original,'UTF8')),'hex')
            AND s.parent_translation_sha256=encode(sha256(convert_to(t.text,'UTF8')),'hex')
          ORDER BY p.id,s.original_start,s.original_end,s.version DESC) record), '[]'::jsonb) AS entries
        FROM public.chapters c JOIN public.editions e ON e.id=c.edition_id JOIN public.books b ON b.id=e.book_id
        WHERE c.id=$1 AND c.published AND b.published`, [chapterId]);
      return rows.length ? { schemaVersion: 1, status: 'published', ...rows[0] } : null;
    },
  };
}
