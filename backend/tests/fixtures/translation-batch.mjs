import { loadLibrary } from '../../../content/library.mjs';
import { textHash } from '../../src/translation-batch.mjs';

const library = loadLibrary();
export function fixtureBatch(id = 'test-chunqiu-ai-v1') {
  const chapters = library.chapters.filter(chapter => chapter.bookId === 'chunqiu').sort((a, b) => a.position - b.position);
  return { schemaVersion: 1, id, bookId: 'chunqiu', chapterIds: chapters.map(chapter => chapter.id), language: 'zh-Hans', status: 'draft',
    translator: '测试 AI（未人工修订）', generation: { assistant: 'Test AI', method: 'test fixture', generatedAt: '2026-10-07T08:00:00Z', standardVersion: 'test-v1', humanReviewed: false },
    standards: ['逐段保留底本，疑点单列。'], entries: chapters.flatMap(chapter => chapter.paragraphs.map(paragraph => ({
      paragraphId: paragraph.id, originalRevision: paragraph.revision, originalSha256: textHash(paragraph.original),
      text: `测试初译：${paragraph.id}`, reviewNotes: ['测试疑点，尚未人工校订。'],
    }))) };
}

