import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowRight, BookmarkSimple, ClockCounterClockwise, DownloadSimple, UploadSimple, X } from '@phosphor-icons/react';
import { readingShelf, describeBookmark, describeProgress, READING_SHELF_LIMITS } from './reading-shelf';
import type { ReadingBookmark, ReadingProgress } from './reading-shelf';
import { readingShelfEra } from './reading-shelf-schema';
import type { EraId } from './types';
import './reading-shelf.css';

type ImportPreview = ReturnType<typeof readingShelf.previewImport>;
function formatDate(value: string) {
  return new Date(value).toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' });
}

export function ReadingShelfPanel({ onResume, onOpenBookmark, personId, eraId, compact = false }: {
  onResume: (progress: ReadingProgress) => void;
  onOpenBookmark: (bookmark: ReadingBookmark) => void;
  personId?: string;
  eraId?: EraId;
  compact?: boolean;
}) {
  const shelf = useSyncExternalStore(readingShelf.subscribe, readingShelf.getSnapshot, readingShelf.getSnapshot);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'bookmarks' | 'progress'>('bookmarks');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const importSequence = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const panelId = useId();
  useEffect(() => () => { ++importSequence.current; }, []);
  const inScope = (item: ReadingProgress | ReadingBookmark) => (!personId || item.personId === personId) && (!eraId || readingShelfEra(item) === eraId);
  const progress = shelf.progress.filter(inScope);
  const bookmarks = shelf.bookmarks.filter(inScope);
  const latest = progress[0];
  const latestDescription = latest ? describeProgress(latest) : null;

  function exportReading() {
    try {
      const blob = new Blob([readingShelf.exportJson()], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      link.href = url; link.download = `ancient-history-reading-${date}.json`;
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('已导出阅读进度和书签。');
    } catch { setMessage('暂时无法导出，请稍后重试。'); }
  }
  async function selectImport(file?: File) {
    const sequence = ++importSequence.current;
    setPreview(null); setMessage(''); setImporting(false);
    if (!file) return;
    if (file.size > READING_SHELF_LIMITS.bytes) { setMessage('文件过大，请选择本站导出的阅读记录文件。'); return; }
    setImporting(true);
    try {
      const result = readingShelf.previewImport(await file.text());
      if (sequence === importSequence.current) setPreview(result);
    } catch {
      if (sequence === importSequence.current) setMessage('文件格式或阅读位置无效。请使用本站导出的 JSON 文件；现有记录已保留。');
    } finally { if (sequence === importSequence.current) setImporting(false); }
  }
  function mergeImport() {
    if (!preview) return;
    try {
      const counts = readingShelf.mergeImport(preview);
      setPreview(null);
      setMessage(`已合并 ${counts.progressCount} 条阅读进度和 ${counts.bookmarkCount} 个书签，重复记录已去重。`);
    } catch { setMessage('导入未完成，现有记录已保留。请重新选择有效文件。'); }
  }

  return <section className={`reading-shelf ${compact ? 'reading-shelf-compact' : ''}`} aria-label={personId ? '此人物的阅读记录' : '我的阅读'}>
    <div className="reading-shelf-entry">
      <div className="reading-shelf-last"><ClockCounterClockwise size={19} aria-hidden="true" />
        {latestDescription ? <p><span>上次读到</span><strong>{latestDescription.title}</strong><small>{latestDescription.detail}</small></p> : <p>读过的篇章、年表和对读，可从这里继续。</p>}
      </div>
      <div className="reading-shelf-actions">
        <button type="button" className="text-link small" disabled={!latest} onClick={() => latest && onResume(latest)}>继续阅读 <ArrowRight size={15} aria-hidden="true" /></button>
        <button type="button" className="reading-shelf-open" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}><BookmarkSimple size={17} aria-hidden="true" />{open ? '收起我的阅读' : '我的书签'}<span>{bookmarks.length}</span></button>
      </div>
    </div>
    {shelf.notice && <p className="reading-shelf-notice" role="status">{shelf.notice}</p>}
    <div id={panelId} hidden={!open} className="reading-shelf-content">
      <div className="reading-shelf-heading"><h2>{compact ? '阅读记录' : '我的阅读'}</h2><p>记录保存在当前浏览器，可导出后在其他设备导入。{eraId && '此处显示当前年代；导入与导出保留全部年代的记录。'}</p></div>
      <div className="reading-shelf-management">
        <div className="reading-shelf-tabs" role="group" aria-label="阅读记录类型"><button type="button" aria-pressed={tab === 'bookmarks'} onClick={() => setTab('bookmarks')}>书签 {bookmarks.length}</button><button type="button" aria-pressed={tab === 'progress'} onClick={() => setTab('progress')}>阅读进度 {progress.length}</button></div>
        {!compact && <div className="reading-shelf-transfer"><button type="button" onClick={exportReading}><DownloadSimple size={15} aria-hidden="true" />导出记录</button><button type="button" disabled={importing} onClick={() => fileInput.current?.click()}><UploadSimple size={15} aria-hidden="true" />{importing ? '正在读取…' : '导入记录'}</button><input ref={fileInput} hidden type="file" accept="application/json,.json" aria-label="选择阅读记录文件" onChange={event => { void selectImport(event.target.files?.[0]); event.target.value = ''; }} /></div>}
      </div>
      {preview && <div className="reading-shelf-import-preview" role="status"><p>可合并 {preview.progressCount} 条进度和 {preview.bookmarkCount} 个书签。已有书签会保留，进度采用较新的记录。</p><div><button type="button" onClick={mergeImport}>合并导入</button><button type="button" onClick={() => { ++importSequence.current; setPreview(null); }}>取消</button></div></div>}
      {message && <p className="reading-shelf-notice" role="status">{message}</p>}
      {tab === 'bookmarks' ? bookmarks.length ? <ul className="reading-shelf-list">{bookmarks.map(bookmark => {
        const description = describeBookmark(bookmark);
        return <li key={bookmark.id}><button type="button" className="reading-shelf-record" onClick={() => onOpenBookmark(bookmark)}><span>{bookmark.kind === 'paragraph' ? '原文段落' : '年表事件 · 保存时标题'}</span><strong>{description.title}</strong><small>{description.detail}</small></button><div className="reading-shelf-row-actions"><time dateTime={bookmark.savedAt}>{formatDate(bookmark.savedAt)}</time><button type="button" className="icon-button" aria-label={`删除书签：${description.title}`} onClick={() => readingShelf.removeBookmark(bookmark.id)}><X size={16} aria-hidden="true" /></button></div></li>;
      })}</ul> : <p className="reading-shelf-empty">在原文段落或年表事件旁点击“加入书签”，下次可直接找到。</p> : progress.length ? <ul className="reading-shelf-list">{progress.map(item => {
        const description = describeProgress(item);
        return <li key={item.id}><button type="button" className="reading-shelf-record" onClick={() => onResume(item)}><strong>{description.title}</strong><small>{description.detail}</small></button><div className="reading-shelf-row-actions"><time dateTime={item.updatedAt}>{formatDate(item.updatedAt)}</time><button type="button" className="icon-button" aria-label={`删除阅读进度：${description.title}`} onClick={() => readingShelf.removeProgress(item.id)}><X size={16} aria-hidden="true" /></button></div></li>;
      })}</ul> : <p className="reading-shelf-empty">打开一份原文、人物年表或史料对读，阅读位置会自动记在这里。</p>}
    </div>
  </section>;
}
