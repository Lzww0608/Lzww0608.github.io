import type { Book } from './types';

export function BookCover({ book, compact = false }: { book: Book; compact?: boolean }) {
  return book.image ? <img src={book.image} alt={`${book.title}书封插图`} loading="lazy" /> :
    <div className={`text-book-cover cover-${book.id} ${compact ? 'cover-compact' : ''}`} aria-hidden="true"><span>{book.title}</span><small>五代史料</small></div>;
}
