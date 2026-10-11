import { useState, useSyncExternalStore } from 'react';
import { BookmarkSimple } from '@phosphor-icons/react';
import { readingShelf } from './reading-shelf';
import type { ChapterParagraph } from './types';
import type { PersonTimelineResponse } from './person-timeline-schema';

export function BookmarkButton(props: { chapterId: string; paragraph: ChapterParagraph; personId?: string } | { personId: string; event: PersonTimelineResponse['events'][number] }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const isMarked = () => 'paragraph' in props ? readingShelf.isParagraphBookmarked(props.chapterId, props.paragraph.id, props.personId) : readingShelf.isEventBookmarked(props.personId, props.event.id);
  const marked = useSyncExternalStore(readingShelf.subscribe, isMarked, () => false);
  const label = 'paragraph' in props ? `原篇第 ${props.paragraph.position} 段` : props.event.title;
  async function toggle() {
    setBusy(true); setNotice('');
    try {
      const result = 'paragraph' in props ? await readingShelf.toggleParagraphBookmark(props) : await readingShelf.toggleEventBookmark(props);
      setNotice(readingShelf.getSnapshot().notice ?? (result ? '书签已保存到当前浏览器。' : '书签已取消。'));
    } catch { setNotice('书签暂时无法保存，可继续阅读。'); }
    finally { setBusy(false); }
  }
  return <span className="reading-bookmark-control"><button type="button" className="reading-bookmark-button" disabled={busy} aria-pressed={marked} aria-label={`${marked ? '取消' : '添加'}书签：${label}`} onClick={() => { void toggle(); }}><BookmarkSimple size={16} weight={marked ? 'fill' : 'regular'} aria-hidden="true" /><span>{marked ? '已收藏' : '加入书签'}</span></button>{notice && <span className="reading-bookmark-notice" role="status">{notice}</span>}</span>;
}
