import { parsePublishedTranslation } from './chapter-schema.ts';
import type { ChapterParagraph, PublishedTranslation } from './types';

type Fetcher = typeof fetch;
type RequestOptions = { apiBase: string; signal?: AbortSignal; fetcher?: Fetcher };
export type TranslationEdit = { text: string; editorName: string; reviewNotes: string[] };

// The credential expires with the page and is never written to browser storage.
let session: { token: string; apiBase: string } | null = null;

export class TranslationEditorError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = 'TranslationEditorError';
    this.status = status;
  }
}

const statusMessages: Record<number, string> = {
  401: '校订密码不正确或已失效，请重新输入。',
  403: '当前页面没有校订权限，请从网站正式地址进入。',
  404: '校订服务尚未启用，或这段译文已不存在。',
  409: '原文或译文已有新版本。本次输入已保留；请先复制修改内容，再关闭并重新读取。',
  413: '译文与校核提示合计超过保存容量。本次输入已保留，请缩短内容后重试。',
  503: '校订服务暂时不可用，请稍后重试。本次输入已保留。',
};

function normalizedApiBase(value: string): string {
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
      || url.username || url.password || url.search || url.hash) throw new Error();
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    throw new TranslationEditorError('校订服务地址不可用，请重新读取页面后再试。');
  }
}

export function hasEditorSession(apiBase: string): boolean {
  if (!session) return false;
  try { return session.apiBase === normalizedApiBase(apiBase); } catch { return false; }
}

export function clearEditorSession(): void {
  session = null;
}

export function validateTranslationEdit(edit: TranslationEdit): string | null {
  if (!edit.text.trim()) return '请填写译文。';
  if (edit.text.length > 20000) return '译文最多可填写 20,000 个字符。';
  if (!edit.editorName.trim()) return '请填写校订署名。';
  if (edit.editorName.length > 80) return '校订署名最多可填写 80 个字符。';
  if (edit.reviewNotes.length > 20) return '校核提示最多可填写 20 条。';
  if (edit.reviewNotes.some(note => note.length > 2000)) return '每条校核提示最多可填写 2,000 个字符。';
  return null;
}

async function postJson(url: string, token: string, body: unknown, options: RequestOptions): Promise<unknown> {
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)])
    : AbortSignal.timeout(15000);
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(url, {
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const timedOut = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
    throw new TranslationEditorError(timedOut
      ? '等待校订服务超时。本次输入已保留，请重新读取确认是否保存，再重试。'
      : '无法连接校订服务。本次输入已保留，请检查网络后重试。');
  }
  if (!response.ok) {
    if (response.status === 401) clearEditorSession();
    throw new TranslationEditorError(statusMessages[response.status] ?? '保存未完成。本次输入已保留，请稍后重试。', response.status);
  }
  try { return await response.json() as unknown; } catch {
    throw new TranslationEditorError('校订服务的返回内容无法读取，请重新读取页面确认是否保存。');
  }
}

export async function authenticateEditorSession(options: RequestOptions & { token: string }): Promise<void> {
  clearEditorSession();
  const apiBase = normalizedApiBase(options.apiBase);
  const token = options.token.trim();
  if (!token) throw new TranslationEditorError('请输入校订密码。');
  const result = await postJson(`${apiBase}/api/editor/session`, token, undefined, options);
  if (typeof result !== 'object' || result === null || !('authenticated' in result) || result.authenticated !== true) {
    throw new TranslationEditorError('无法确认校订权限，请重新输入密码。');
  }
  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  session = { token, apiBase };
}

export async function saveEditedTranslation(options: RequestOptions & TranslationEdit & { paragraph: ChapterParagraph }): Promise<PublishedTranslation> {
  const validation = validateTranslationEdit(options);
  if (validation) throw new TranslationEditorError(validation);
  const apiBase = normalizedApiBase(options.apiBase);
  const current = session;
  if (!current || current.apiBase !== apiBase) throw new TranslationEditorError('请先输入校订密码，进入校订。', 401);
  const previous = options.paragraph.translation;
  if (!previous) throw new TranslationEditorError('这段原文尚无已发布译文，请重新读取。', 404);
  const result = await postJson(`${apiBase}/api/editor/translations/${encodeURIComponent(options.paragraph.id)}`, current.token, {
    paragraphId: options.paragraph.id,
    expectedOriginalRevision: options.paragraph.revision,
    expectedTranslationId: previous.id,
    text: options.text,
    editorName: options.editorName.trim(),
    reviewNotes: options.reviewNotes,
  }, options);
  try {
    if (typeof result !== 'object' || result === null || !('paragraphId' in result)
      || result.paragraphId !== options.paragraph.id || !('translation' in result)) throw new Error();
    const translation = parsePublishedTranslation(result.translation);
    if (translation.id === previous.id || translation.version <= previous.version) throw new Error();
    return translation;
  } catch {
    throw new TranslationEditorError('校订服务返回的版本信息不完整，请重新读取页面确认是否保存。');
  }
}
