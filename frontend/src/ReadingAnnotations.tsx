import { useEffect, useMemo, useState } from 'react';
import type { ChapterParagraph } from './types';
import { hasReadingAnnotations, readReadingAnnotations } from './reading-annotations-loader';
import type { ReadingAnnotationResult } from './reading-annotations-loader';
import { loadOriginalConverter } from './original-script';
import type { OriginalConverter } from './original-script';

const kindLabels = { office: '官职', military: '军制', place: '地名' } as const;

export function ReadingAnnotations({ paragraph, sentenceIndex, displayedOriginal }: {
  paragraph: ChapterParagraph;
  sentenceIndex: number;
  displayedOriginal: string;
}) {
  const [converter, setConverter] = useState<OriginalConverter | null>(null);
  const simplified = displayedOriginal !== paragraph.original;
  const supported = hasReadingAnnotations(paragraph.id, sentenceIndex);
  useEffect(() => {
    if (!simplified || !supported) return;
    let cancelled = false;
    loadOriginalConverter().then(value => { if (!cancelled) setConverter(() => value); }).catch(() => {});
    return () => { cancelled = true; };
  }, [simplified, supported]);
  const [attempt, setAttempt] = useState(0);
  const binding = useMemo(() => Symbol('reading-annotation-source'),
    [paragraph.id, paragraph.revision, paragraph.original, sentenceIndex, attempt]);
  const [loaded, setLoaded] = useState<{ binding: symbol; result: ReadingAnnotationResult } | null>(null);
  useEffect(() => {
    if (!supported) return;
    const controller = new AbortController();
    readReadingAnnotations({ paragraph, sentenceIndex, archiveBase: import.meta.env.BASE_URL, signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setLoaded({ binding, result }); })
      .catch(() => {
        if (!controller.signal.aborted) setLoaded({ binding, result: { status: 'unavailable', annotations: [] } });
      });
    return () => controller.abort();
  }, [binding, supported]);
  const current = loaded?.binding === binding ? loaded.result : null;
  if (!supported) return null;
  if (current?.status === 'available' && !current.annotations.length) return null;
  return <section className="reading-annotations" aria-label="名物注释" lang="zh-Hans" aria-busy={!current}>
    <h3>名物注释</h3>
    {!current ? <p className="reading-annotations-notice" role="status">正在读取注释…</p>
      : current.status === 'stale' ? <p className="reading-annotations-notice">本段原文已变更，原有注释暂停显示，待重新核对。</p>
      : current.status === 'unavailable' ? <div>
        <p className="reading-annotations-notice" role="status">注释暂时无法读取。</p>
        <button type="button" className="sentence-translation-expand" onClick={() => setAttempt(value => value + 1)}>重试注释</button>
      </div>
      : <ul className="reading-annotations-list">{current.annotations.map(annotation => <li key={annotation.id}>
        <div className="reading-annotations-term"><strong lang={simplified && converter ? 'zh-Hans' : 'zh-Hant'}>{simplified && converter ? converter(annotation.term) : annotation.term}</strong><span>{kindLabels[annotation.kind]}</span></div>
        <p>{annotation.explanation}</p>
        {annotation.uncertainty && <p className="reading-annotations-uncertainty"><span>尚待考证：</span>{annotation.uncertainty}</p>}
        <ul className="reading-annotations-references" aria-label={`${annotation.term}的依据`}>{annotation.references.map(reference => <li key={reference.id}>
          <a href={reference.url} target="_blank" rel="noopener noreferrer" aria-label={`${reference.title} · ${reference.locator}（在新标签页打开）`}>{reference.title} · {reference.locator}</a>
        </li>)}</ul>
      </li>)}</ul>}
  </section>;
}
