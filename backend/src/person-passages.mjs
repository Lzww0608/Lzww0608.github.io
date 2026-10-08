import { publicParagraphJson, latestPublishedTranslationJoin } from './public-paragraph-sql.mjs';

// Offset cursors are decimal strings. Reject coercible numbers, signs, spaces and unsafe integers.
export function parsePersonPassagePagination(searchParams) {
  const limitText = searchParams.get('limit') ?? '50';
  const cursorText = searchParams.get('cursor') ?? '0';
  if (searchParams.getAll('limit').length > 1 || searchParams.getAll('cursor').length > 1
    || searchParams.getAll('bookId').length > 1 || !/^(?:0|[1-9][0-9]*)$/.test(cursorText)
    || !/^[1-9][0-9]*$/.test(limitText)) throw new TypeError('Invalid passage pagination.');
  const limit = Number(limitText), cursor = Number(cursorText);
  const bookId = searchParams.get('bookId');
  if (!Number.isSafeInteger(cursor) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100
    || (bookId !== null && !/^[a-z0-9][a-z0-9-]*$/.test(bookId))) throw new TypeError('Invalid passage pagination.');
  return { bookId, limit, cursor };
}

const passageJoins = `FROM public.passages x JOIN public.chapters c ON c.id=x.chapter_id
  JOIN public.editions e ON e.id=c.edition_id JOIN public.books b ON b.id=e.book_id`;
const currentSpans = `EXISTS (SELECT 1 FROM public.passage_spans s WHERE s.passage_id=x.id)
  AND NOT EXISTS (SELECT 1 FROM public.passage_spans s
    LEFT JOIN public.paragraphs p ON p.id=s.paragraph_id
    LEFT JOIN public.paragraph_revisions r ON r.paragraph_id=p.id AND r.revision=p.current_revision
    WHERE s.passage_id=x.id AND (p.id IS NULL OR p.chapter_id<>x.chapter_id
      OR p.current_revision<>s.original_revision OR r.original IS NULL
      OR encode(sha256(convert_to(r.original,'UTF8')),'hex')<>s.original_sha256
      OR s.end_offset>char_length(r.original)))`;
const passageColumns = `x.id, x.title, b.id AS book_id, b.title AS book_title, c.id AS chapter_id,
  c.title AS chapter_title, c.position AS chapter_position, e.label AS edition, c.source_url,
  (SELECT min(p.position) FROM public.passage_spans s JOIN public.paragraphs p ON p.id=s.paragraph_id WHERE s.passage_id=x.id) AS paragraph_position`;
const sortColumns = 'book_id, chapter_position, paragraph_position, id';
const spanJson = `(SELECT jsonb_agg(jsonb_build_object('paragraphId',s.paragraph_id,'originalRevision',s.original_revision,
  'originalSha256',s.original_sha256,'start',s.start_offset,'end',s.end_offset) ORDER BY s.position)
  FROM public.passage_spans s WHERE s.passage_id=v.id)`;
const paragraphsJson = `(SELECT jsonb_agg(${publicParagraphJson} ORDER BY p.position)
  FROM public.paragraphs p JOIN public.paragraph_revisions r ON r.paragraph_id=p.id AND r.revision=p.current_revision
  ${latestPublishedTranslationJoin}
  WHERE EXISTS (SELECT 1 FROM public.passage_spans s WHERE s.passage_id=v.id AND s.paragraph_id=p.id))`;
const passageJson = `jsonb_build_object('id',v.id,'title',v.title,'bookId',v.book_id,'bookTitle',v.book_title,
  'chapterId',v.chapter_id,'chapterTitle',v.chapter_title,'chapterPosition',v.chapter_position,
  'edition',v.edition,'sourceUrl',v.source_url,'spans',${spanJson},'paragraphs',${paragraphsJson})`;

export function createPersonPassagesRepository(pool) {
  return {
    async personPassages(personId, { bookId = null, limit = 50, cursor = 0 } = {}) {
      // Filtering, pagination counts, originals and current translations share one statement snapshot.
      const { rows } = await pool.query(`WITH candidates AS (
        SELECT ${passageColumns}, pp.kind, (${currentSpans}) AS available ${passageJoins}
        JOIN public.person_passages pp ON pp.passage_id=x.id
        WHERE pp.person_id=$1 AND c.published AND b.published AND ($2::text IS NULL OR b.id=$2)
      ), visible AS (SELECT * FROM candidates WHERE available),
      page AS (SELECT * FROM visible ORDER BY ${sortColumns} LIMIT $3 OFFSET $4)
      SELECT EXISTS(SELECT 1 FROM public.passage_people WHERE id=$1) AS person_exists,
        ($2::text IS NULL OR EXISTS(SELECT 1 FROM public.books WHERE id=$2 AND published)) AS book_exists,
        (SELECT jsonb_build_object('bookCount',book_count,'chapterCount',chapter_count,'paragraphCount',paragraph_count)
          FROM public.person_passage_index WHERE id) AS coverage,
        (SELECT count(*)::int FROM visible) AS total,
        encode(sha256(convert_to(coalesce((SELECT string_agg(id,chr(10) ORDER BY ${sortColumns}) FROM visible),''),'UTF8')),'hex') AS result_set_revision,
        (SELECT count(*)::int FROM candidates WHERE NOT available) AS unavailable_count,
        (SELECT coalesce(jsonb_agg(${passageJson} || jsonb_build_object('kind',v.kind) ORDER BY v.${sortColumns.replaceAll(', ', ', v.')}),'[]'::jsonb)
          FROM page v) AS items`, [personId, bookId, limit, cursor]);
      const row = rows[0];
      if (!row.person_exists || !row.book_exists) return null;
      return { schemaVersion: 1, scope: 'current-archive', personId, bookId,
        coverage: row.coverage ?? { bookCount: 0, chapterCount: 0, paragraphCount: 0 },
        total: row.total, resultSetRevision: row.result_set_revision, unavailableCount: row.unavailable_count,
        nextCursor: cursor + row.items.length < row.total ? String(cursor + row.items.length) : null,
        items: row.items };
    },
    async passage(id) {
      const { rows } = await pool.query(`WITH visible AS (
        SELECT ${passageColumns} ${passageJoins} WHERE x.id=$1 AND c.published AND b.published AND ${currentSpans}
      ) SELECT ${passageJson} || jsonb_build_object('people',
        (SELECT jsonb_agg(jsonb_build_object('personId',pp.person_id,'kind',pp.kind) ORDER BY pp.person_id)
          FROM public.person_passages pp WHERE pp.passage_id=v.id)) AS passage FROM visible v`, [id]);
      return rows[0] ? { schemaVersion: 1, passage: rows[0].passage } : null;
    },
  };
}
