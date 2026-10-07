import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { ChapterParagraph, PublishedTranslation } from './types';
import {
  authenticateEditorSession, clearEditorSession, hasEditorSession,
  saveEditedTranslation, TranslationEditorError, validateTranslationEdit,
} from './translation-editor-api';
import './translation-editor.css';

type Props = {
  paragraph: ChapterParagraph;
  apiBase: string;
  onSaved: (translation: PublishedTranslation) => void;
  onClose: () => void;
};

export function TranslationEditor({ paragraph, apiBase, onSaved, onClose }: Props) {
  // Bind the form to the exact version the reader opened, even if a live read updates behind it.
  const editingParagraph = useRef(paragraph).current;
  const titleId = useId();
  const descriptionId = useId();
  const passwordId = useId();
  const textId = useId();
  const editorId = useId();
  const notesId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const passwordField = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const pendingNavigation = useRef<(() => void) | null>(null);
  const initial = useRef({
    text: editingParagraph.translation?.text ?? '',
    notes: editingParagraph.translation?.reviewNotes?.join('\n') ?? '',
  }).current;
  const [text, setText] = useState(initial.text);
  const [editorName, setEditorName] = useState('');
  const [notes, setNotes] = useState(initial.notes);
  const [authenticated, setAuthenticated] = useState(() => hasEditorSession(apiBase));
  const [busy, setBusy] = useState<'auth' | 'save' | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [conflicted, setConflicted] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirty = text !== initial.text || notes !== initial.notes || editorName.trim().length > 0;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    return () => {
      request.current?.abort();
      element?.close();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    if (!authenticated && busy === null) passwordField.current?.focus();
  }, [authenticated, busy]);

  useEffect(() => {
    if (!dirty && busy === null) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const beforeNavigation = (event: Event) => {
      event.preventDefault();
      if (busyRef.current) { setStatus('正在处理，请完成后再离开。'); return; }
      const detail = (event as CustomEvent<{ continueNavigation: () => void }>).detail;
      pendingNavigation.current = detail.continueNavigation;
      setConfirmDiscard(true);
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('ancient-history:before-navigation', beforeNavigation);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('ancient-history:before-navigation', beforeNavigation);
    };
  }, [dirty, busy]);

  function begin(kind: 'auth' | 'save'): AbortController {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    busyRef.current = true;
    setBusy(kind);
    setError('');
    setStatus(kind === 'auth' ? '正在确认校订权限…' : '正在保存新版本…');
    setConfirmDiscard(false);
    return controller;
  }

  function failed(cause: unknown): void {
    if (cause instanceof Error && cause.name === 'AbortError') return;
    setStatus('');
    setError(cause instanceof TranslationEditorError ? cause.message : '操作未完成，本次输入已保留，请稍后重试。');
    if (cause instanceof TranslationEditorError && cause.status === 401) {
      setAuthenticated(false);
    }
    if (cause instanceof TranslationEditorError && cause.status === 409) setConflicted(true);
  }

  function finish(controller: AbortController): void {
    if (!controller.signal.aborted) {
      busyRef.current = false;
      setBusy(null);
    }
  }

  async function authenticate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busyRef.current) return;
    const password = passwordField.current?.value ?? '';
    const controller = begin('auth');
    try {
      await authenticateEditorSession({ apiBase, token: password, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (passwordField.current) passwordField.current.value = '';
      setAuthenticated(true);
      setStatus('已进入校订，可以保存新版本。');
    } catch (cause) { if (!controller.signal.aborted) failed(cause); }
    finally { finish(controller); }
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busyRef.current || conflicted) return;
    const edit = { text, editorName, reviewNotes: notes.split(/\r?\n/).map(note => note.trim()).filter(Boolean) };
    const validation = validateTranslationEdit(edit);
    if (validation) { setError(validation); setStatus(''); return; }
    const controller = begin('save');
    try {
      const translation = await saveEditedTranslation({ apiBase, paragraph: editingParagraph, ...edit, signal: controller.signal });
      if (controller.signal.aborted) return;
      setStatus(`新版本 ${translation.version} 已保存。`);
      onSaved(translation);
      onClose();
    } catch (cause) { if (!controller.signal.aborted) failed(cause); }
    finally { finish(controller); }
  }

  function close(): void {
    if (busyRef.current) { setStatus('正在处理，请完成后再关闭。'); return; }
    pendingNavigation.current = null;
    if (dirty) { setConfirmDiscard(true); return; }
    onClose();
  }

  function exitEditing(): void {
    clearEditorSession();
    if (passwordField.current) passwordField.current.value = '';
    setAuthenticated(false);
    setStatus('已退出校订。本次输入仍保留，再次保存需要输入密码。');
    setError('');
  }

  function discard(): void {
    const navigate = pendingNavigation.current;
    pendingNavigation.current = null;
    onClose();
    navigate?.();
  }

  return <dialog ref={dialog} className="dialog dialog-wide translation-editor"
    aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); close(); }}>
    <div className="dialog-top translation-editor-top">
      <h2 id={titleId}>修订译文</h2>
      <button type="button" className="translation-editor-close" onClick={close} disabled={busy !== null} aria-label="关闭修订译文">关闭</button>
    </div>
    <div className="translation-editor-body">
      <p id={descriptionId} className="translation-editor-description">保存会生成新版本，旧版本保留。原文只读，校订署名会随译文公开显示。</p>
      <section className="translation-editor-original" aria-labelledby={`${titleId}-original`}>
        <h3 id={`${titleId}-original`}>原文</h3>
        <p lang="zh-Hant">{editingParagraph.original}</p>
      </section>
      {!authenticated ? <form className="translation-editor-auth" onSubmit={event => { void authenticate(event); }}>
        <label htmlFor={passwordId}>校订密码</label>
        <div className="translation-editor-password-row">
          <input ref={passwordField} id={passwordId} type="password"
            autoComplete="off" autoCapitalize="none" spellCheck={false}
            disabled={busy !== null} required aria-describedby={`${passwordId}-help`} />
          <button type="submit" className="quiet-button" disabled={busy !== null}>{busy === 'auth' ? '正在确认…' : '进入校订'}</button>
        </div>
        <p id={`${passwordId}-help`} className="translation-editor-help">密码仅在本次页面内使用。退出校订或刷新页面后需要重新输入。</p>
      </form> : <div className="translation-editor-session">
        <span>已进入校订</span>
        <button type="button" className="quiet-button" onClick={exitEditing} disabled={busy !== null}>退出校订</button>
      </div>}
      <form className="translation-editor-form" onSubmit={event => { void save(event); }}>
        <div className="translation-editor-field">
          <label htmlFor={textId}>译文 <span>当前第 {editingParagraph.translation?.version ?? 0} 版</span></label>
          <textarea id={textId} lang="zh-Hans" value={text} onChange={event => setText(event.target.value)}
            disabled={busy !== null} rows={10} required aria-describedby={`${textId}-help`} />
          <p id={`${textId}-help`} className="translation-editor-help">逐段校订，最多 20,000 个字符。已输入 {text.length.toLocaleString('zh-CN')} 个字符。</p>
        </div>
        <div className="translation-editor-field">
          <label htmlFor={editorId}>校订署名</label>
          <input id={editorId} value={editorName} onChange={event => setEditorName(event.target.value)}
            disabled={busy !== null} autoComplete="off" required aria-describedby={`${editorId}-help`} />
          <p id={`${editorId}-help`} className="translation-editor-help">请填写公开显示的姓名或笔名，最多 80 个字符。</p>
        </div>
        <div className="translation-editor-field">
          <label htmlFor={notesId}>校核提示 <span>可选</span></label>
          <textarea id={notesId} value={notes} onChange={event => setNotes(event.target.value)}
            disabled={busy !== null} rows={4} aria-describedby={`${notesId}-help`} />
          <p id={`${notesId}-help`} className="translation-editor-help">每行一条，最多 20 条；每条最多 2,000 个字符。已解决的疑点可以删除。</p>
        </div>
        <div className="translation-editor-feedback" aria-live="polite" aria-atomic="true">
          {status && <p role="status">{status}</p>}
          {error && <p className="translation-editor-error" role="alert">{error}</p>}
        </div>
        {confirmDiscard ? <div className="translation-editor-discard">
          <p>有尚未保存的修改，是否放弃并关闭？</p>
          <div>
            <button type="button" className="quiet-button" onClick={() => { pendingNavigation.current = null; setConfirmDiscard(false); }}>继续校订</button>
            <button type="button" className="quiet-button" onClick={discard}>放弃修改并关闭</button>
          </div>
        </div> : <div className="translation-editor-actions">
          <button type="button" className="quiet-button" onClick={close} disabled={busy !== null}>取消</button>
          <button type="submit" className="primary-button" disabled={!authenticated || busy !== null || conflicted || !editingParagraph.translation}>
            {busy === 'save' ? '正在保存…' : '保存新版本'}
          </button>
        </div>}
      </form>
    </div>
  </dialog>;
}
