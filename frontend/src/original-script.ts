import type { ChapterParagraph, OriginalScript } from './types.ts';

export const ORIGINAL_SCRIPT_KEY = 'ancient-history:original-script:v1';
export type OriginalConverter = (text: string) => string;

export function readOriginalScript(storage?: Pick<Storage, 'getItem'>): OriginalScript {
  try {
    const saved = (storage ?? (typeof window === 'undefined' ? undefined : window.localStorage))?.getItem(ORIGINAL_SCRIPT_KEY);
    return saved === 'simplified' ? 'simplified' : 'traditional';
  } catch {
    return 'traditional';
  }
}

export function saveOriginalScript(script: OriginalScript, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? (typeof window === 'undefined' ? undefined : window.localStorage))?.setItem(ORIGINAL_SCRIPT_KEY, script);
  } catch {
    // Reading still works when the browser cannot store preferences.
  }
}

let converterPromise: Promise<OriginalConverter> | null = null;
export function loadOriginalConverter(): Promise<OriginalConverter> {
  converterPromise ??= import('./script-converter.ts').then(module => module.simplifyOriginal).catch(error => {
    converterPromise = null;
    throw error;
  });
  return converterPromise;
}

export function originalParagraphs(
  paragraphs: ChapterParagraph[], script: OriginalScript, converter: OriginalConverter | null,
): ChapterParagraph[] {
  if (script === 'traditional' || !converter) return paragraphs;
  return paragraphs.map(paragraph => ({ ...paragraph, original: converter(paragraph.original) }));
}
