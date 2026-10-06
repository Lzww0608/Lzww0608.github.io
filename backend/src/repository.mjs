export function createRepository(pool) {
  const publicChapter = `FROM chapters c JOIN editions e ON e.id=c.edition_id JOIN books b ON b.id=e.book_id WHERE c.published AND b.published`;
  return {
    async health() { await pool.query('SELECT 1'); return { status: 'ok', database: 'ok' }; },
    async books() {
      const { rows } = await pool.query(`SELECT b.id, b.title, b.author, b.description, b.source_url AS "sourceUrl", count(c.id)::int AS "chapterCount" FROM books b LEFT JOIN editions e ON e.book_id=b.id LEFT JOIN chapters c ON c.edition_id=e.id AND c.published WHERE b.published GROUP BY b.id ORDER BY b.id`);
      return rows;
    },
    async chapters(bookId) {
      const book = await pool.query('SELECT id FROM books WHERE id=$1 AND published', [bookId]);
      if (!book.rowCount) return null;
      const { rows } = await pool.query(`SELECT c.id, c.title, c.position, c.scope, e.label AS edition ${publicChapter} AND b.id=$1 ORDER BY e.id, c.position`, [bookId]);
      return rows;
    },
    async chapter(id) {
      // One statement provides one snapshot of originals and the translations tied to them.
      const { rows } = await pool.query(`SELECT c.id, c.title, c.position, c.scope, c.source_url AS "sourceUrl", c.notes, b.id AS "bookId", b.title AS "bookTitle", b.author, e.id AS "editionId", e.label AS edition,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'position', p.position, 'revision', r.revision, 'original', r.original,
          'translation', CASE WHEN t.id IS NULL THEN NULL ELSE jsonb_build_object('id', t.id::text, 'text', t.text, 'language', t.language, 'version', t.version, 'translator', t.translator) END) ORDER BY p.position)
          FROM paragraphs p JOIN paragraph_revisions r ON r.paragraph_id=p.id AND r.revision=p.current_revision
          LEFT JOIN LATERAL (SELECT * FROM translations t WHERE t.paragraph_id=p.id AND t.original_revision=p.current_revision AND t.language='zh-Hans' AND t.status='published' ORDER BY t.version DESC LIMIT 1) t ON true
          WHERE p.chapter_id=c.id), '[]'::jsonb) AS paragraphs
        ${publicChapter} AND c.id=$1`, [id]);
      return rows[0] ?? null;
    },
    async search(query, limit = 20) {
      // Escape LIKE metacharacters; user input is literal text and always parameterized.
      const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
      const { rows } = await pool.query(`SELECT p.id, c.id AS "chapterId", c.title AS "chapterTitle", b.title AS "bookTitle", r.original
        FROM paragraphs p JOIN paragraph_revisions r ON r.paragraph_id=p.id AND r.revision=p.current_revision
        JOIN chapters c ON c.id=p.chapter_id JOIN editions e ON e.id=c.edition_id JOIN books b ON b.id=e.book_id
        WHERE c.published AND b.published AND r.original ILIKE $1 ORDER BY b.id, c.position, p.position LIMIT $2`, [pattern, limit]);
      return rows;
    },
  };
}
