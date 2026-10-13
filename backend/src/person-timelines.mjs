import { createHash } from 'node:crypto';
import { publicParagraphJson, latestPublishedTranslationJoin } from './public-paragraph-sql.mjs';
const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');

export function createPersonTimelinesRepository(pool) {
  return { async personTimeline(personId, { eventIds } = {}) {
    // One statement supplies a consistent original/publication snapshot, including all alternative evidence.
    const { rows } = await pool.query(`WITH registered AS (
        SELECT ${eventIds ? `jsonb_set(document, '{events}', COALESCE((SELECT jsonb_agg(event ORDER BY position)
          FROM jsonb_array_elements(document->'events') WITH ORDINALITY AS selected(event,position)
          WHERE event->>'id'=ANY($2::text[])), '[]'::jsonb))` : 'document'} AS document
        FROM public.person_timelines WHERE person_id=$1
      ), refs AS (
        SELECT DISTINCT ref #>> '{}' AS paragraph_id FROM registered
          CROSS JOIN LATERAL jsonb_path_query(document,'$.events[*].evidence[*].paragraphId') AS ref
        UNION SELECT DISTINCT ref #>> '{}' AS paragraph_id FROM registered
          CROSS JOIN LATERAL jsonb_path_query(document,'$.events[*].variants[*].evidence[*].paragraphId') AS ref
      ), sources AS (
        SELECT p.id,b.id AS book_id,b.title AS book_title,c.id AS chapter_id,c.title AS chapter_title,
          b.published AND c.published AS visible,${publicParagraphJson} AS paragraph
        FROM refs JOIN public.paragraphs p ON p.id=refs.paragraph_id
          JOIN public.paragraph_revisions r ON r.paragraph_id=p.id AND r.revision=p.current_revision
          JOIN public.chapters c ON c.id=p.chapter_id JOIN public.editions e ON e.id=c.edition_id JOIN public.books b ON b.id=e.book_id
          ${latestPublishedTranslationJoin}
      ) SELECT document,COALESCE((SELECT jsonb_object_agg(id,to_jsonb(sources)) FROM sources),'{}'::jsonb) AS sources FROM registered`, eventIds ? [personId,eventIds] : [personId]);
    if (!rows.length) return null;
    const { document, sources } = rows[0]; let unavailableCount = 0;
    const resolve = ref => {
      const source=sources[ref.paragraphId], p=source?.paragraph;
      if (!source?.visible || source.chapter_id!==ref.chapterId || p?.id!==ref.paragraphId
        || p.revision!==ref.originalRevision || sha(p.original)!==ref.originalSha256 || !p.original.includes(ref.excerpt)
        || !p.translation?.text?.trim()) return null;
      return {...ref,bookId:source.book_id,bookTitle:source.book_title,chapterTitle:source.chapter_title,paragraph:p};
    };
    const events = document.events.flatMap(event => {
      const evidence=event.evidence.map(resolve), variants=(event.variants??[]).map(v=>({...v,evidence:v.evidence.map(resolve)}));
      if (evidence.some(e=>!e) || variants.some(v=>v.evidence.some(e=>!e))) { unavailableCount++; return []; }
      return [{...event,evidence,...(event.variants ? {variants} : {})}];
    });
    const result={schemaVersion:1,scope:'current-archive',personId,events,unavailableCount};
    return {...result,resultSetRevision:sha(JSON.stringify(result))};
  } };
}
