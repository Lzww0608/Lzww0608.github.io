import { useEffect, useMemo, useState } from 'react';
import { paragraphTranslationParts, readSentenceTranslationParts } from './sentence-translations-loader';
import type { SentenceTranslationPart } from './sentence-translations-loader';
import type { ChapterParagraph } from './types';
import { historyApiBase } from './history-api';

interface LoadedParts {
  paragraphId: string;
  revision: number;
  original: string;
  translationId: string | undefined;
  translationVersion: number | undefined;
  translationText: string | undefined;
  displayedOriginal: string;
  parts: SentenceTranslationPart[];
}

export function useSentenceTranslations(paragraph: ChapterParagraph, displayedOriginal: string) {
  const [loaded, setLoaded] = useState<LoadedParts | null>(null);
  const translationId = paragraph.translation?.id;
  const translationVersion = paragraph.translation?.version;
  const translationText = paragraph.translation?.text;
  const fallback = useMemo(() => paragraphTranslationParts(paragraph, displayedOriginal),
    [paragraph.id, paragraph.revision, paragraph.original, translationId, translationVersion, translationText, displayedOriginal]);

  useEffect(() => {
    const controller = new AbortController();
    const binding = {
      paragraphId: paragraph.id, revision: paragraph.revision, original: paragraph.original,
      translationId, translationVersion, translationText, displayedOriginal,
    };
    readSentenceTranslationParts({ paragraph, displayedOriginal, archiveBase: import.meta.env.BASE_URL, apiBase: historyApiBase, signal: controller.signal })
      .then(parts => { if (!controller.signal.aborted) setLoaded({ ...binding, parts }); })
      .catch(() => { if (!controller.signal.aborted) setLoaded({ ...binding, parts: fallback }); });
    return () => controller.abort();
  }, [paragraph.id, paragraph.revision, paragraph.original, translationId, translationVersion, translationText, displayedOriginal]);

  const current = loaded?.paragraphId === paragraph.id && loaded.revision === paragraph.revision
    && loaded.original === paragraph.original && loaded.translationId === translationId
    && loaded.translationVersion === translationVersion && loaded.translationText === translationText
    && loaded.displayedOriginal === displayedOriginal;
  return { parts: current ? loaded.parts : fallback, pending: !current && !!paragraph.translation };
}
