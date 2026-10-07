import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  authenticateEditorSession, clearEditorSession, hasEditorSession,
  saveEditedTranslation, TranslationEditorError, validateTranslationEdit,
} from '../src/translation-editor-api.ts';

const apiBase = 'https://api.example';
const token = 'test-only-editor-password';
const previous = { id: '42', text: '旧译文。', language: 'zh-Hans', version: 1, translator: 'Codex', origin: 'ai', reviewStatus: 'pending', reviewNotes: ['待核对'] };
const paragraph = { id: 'new-v08-p1', original: '高祖聖文章武明德孝皇帝。', position: 1, revision: 3, translation: previous };
const edit = { text: '校订后的译文。\n保留分行。', editorName: '校订者', reviewNotes: ['人名已核对'] };
const published = { ...previous, id: '43', text: edit.text, version: 2, translator: edit.editorName, origin: 'human', reviewStatus: 'owner-edited', reviewNotes: edit.reviewNotes };
const response = (value, status = 200) => new Response(JSON.stringify(value), { status });
const signIn = () => authenticateEditorSession({ apiBase, token, fetcher: async () => response({ authenticated: true }) });
const save = extra => saveEditedTranslation({ apiBase, paragraph: structuredClone(paragraph), ...edit, ...extra });

beforeEach(clearEditorSession);
afterEach(clearEditorSession);

test('authentication uses an authorization header without storing credentials in URL or payload', async () => {
  let request;
  await authenticateEditorSession({ apiBase: `${apiBase}/`, token, fetcher: async (url, init) => {
    request = { url, init };
    return response({ authenticated: true });
  } });
  assert.equal(request.url, `${apiBase}/api/editor/session`);
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.credentials, 'omit');
  assert.equal(request.init.redirect, 'error');
  assert.equal(request.init.headers.Authorization, `Bearer ${token}`);
  assert.equal(request.init.body, undefined);
  assert.equal(request.url.includes(token), false);
  assert.equal(hasEditorSession(apiBase), true);
  assert.equal(hasEditorSession('https://other.example'), false);
  clearEditorSession();
  assert.equal(hasEditorSession(apiBase), false);
});

test('invalid authentication responses and a wrong password never establish a session', async () => {
  for (const value of [null, {}, { authenticated: false }, { authenticated: 'true' }]) {
    await assert.rejects(authenticateEditorSession({ apiBase, token, fetcher: async () => response(value) }), TranslationEditorError);
    assert.equal(hasEditorSession(apiBase), false);
  }
  await assert.rejects(authenticateEditorSession({ apiBase, token, fetcher: async () => response({ message: token }, 401) }), error => {
    assert.equal(error.status, 401);
    assert.match(error.message, /密码/);
    assert.equal(error.message.includes(token), false);
    return true;
  });
});

test('a new version is bound to the original revision and preceding translation without a credential payload', async () => {
  await signIn();
  const source = structuredClone(paragraph);
  const sourceBefore = structuredClone(source);
  let request;
  const result = await save({ paragraph: source, fetcher: async (url, init) => {
    request = { url, init };
    return response({ paragraphId: paragraph.id, translation: published });
  } });
  assert.deepEqual(result, published);
  assert.deepEqual(source, sourceBefore);
  assert.equal(request.url, `${apiBase}/api/editor/translations/new-v08-p1`);
  assert.equal(request.init.headers.Authorization, `Bearer ${token}`);
  assert.equal(request.init.credentials, 'omit');
  assert.equal(request.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(request.init.body), {
    paragraphId: paragraph.id, expectedOriginalRevision: 3, expectedTranslationId: '42', ...edit,
  });
  assert.equal(request.init.body.includes(token), false);
  assert.equal(hasEditorSession(apiBase), true);
  assert.equal(hasEditorSession('https://other.example'), false);
});

test('401 clears only the in-memory credential; 409 reports a version conflict without changing input', async () => {
  await signIn();
  await assert.rejects(save({ fetcher: async () => response({}, 401) }), error => error.status === 401);
  assert.equal(hasEditorSession(apiBase), false);
  await signIn();
  const source = structuredClone(paragraph);
  await assert.rejects(save({ paragraph: source, fetcher: async () => response({ translation: published }, 409) }), error => {
    assert.equal(error.status, 409);
    assert.match(error.message, /本次输入已保留/);
    return true;
  });
  assert.deepEqual(source, paragraph);
  assert.equal(hasEditorSession(apiBase), true);
});

test('saving refuses an unrelated API address and a missing published translation before requesting', async () => {
  await signIn();
  let calls = 0;
  const fetcher = async () => { calls++; return response({}); };
  await assert.rejects(save({ apiBase: 'https://other.example', fetcher }), error => error.status === 401);
  await assert.rejects(save({ paragraph: { ...paragraph, translation: null }, fetcher }), error => error.status === 404);
  assert.equal(calls, 0);
});

test('blank and oversized edits are rejected before sending a request', async () => {
  await signIn();
  const invalid = [
    { text: ' \n ' }, { text: '字'.repeat(20001) },
    { editorName: '   ' }, { editorName: '名'.repeat(81) },
    { reviewNotes: Array(21).fill('提示') }, { reviewNotes: ['字'.repeat(2001)] },
  ];
  let calls = 0;
  const fetcher = async () => { calls++; return response({}); };
  for (const extra of invalid) {
    assert.notEqual(validateTranslationEdit({ ...edit, ...extra }), null);
    await assert.rejects(save({ ...extra, fetcher }), TranslationEditorError);
  }
  assert.equal(calls, 0);
  assert.equal(validateTranslationEdit({ text: '字'.repeat(20000), editorName: '名'.repeat(80), reviewNotes: Array(20).fill('字'.repeat(2000)) }), null);
});

test('a mismatched paragraph or malformed/non-new translation is rejected before updating the reader', async () => {
  await signIn();
  const invalid = [
    null, {}, { paragraphId: 'wrong', translation: published },
    { paragraphId: paragraph.id, translation: { ...published, text: null } },
    { paragraphId: paragraph.id, translation: { ...published, translator: 42 } },
    { paragraphId: paragraph.id, translation: { ...published, reviewNotes: [null] } },
    { paragraphId: paragraph.id, translation: { ...published, id: previous.id } },
    { paragraphId: paragraph.id, translation: { ...published, version: previous.version } },
  ];
  for (const value of invalid) {
    await assert.rejects(save({ fetcher: async () => response(value) }), error => {
      assert.match(error.message, /版本信息/);
      return true;
    });
  }
});

test('permission, unavailable, too-long and offline errors produce useful messages without server diagnostics', async () => {
  await signIn();
  for (const status of [403, 404, 413, 503]) {
    await assert.rejects(save({ fetcher: async () => response({ diagnostic: token }, status) }), error => {
      assert.equal(error.status, status);
      assert.equal(error.message.includes(token), false);
      assert.ok(error.message.length > 8);
      return true;
    });
  }
  await assert.rejects(save({ fetcher: async () => { throw new TypeError(token); } }), error => {
    assert.match(error.message, /无法连接/);
    assert.equal(error.message.includes(token), false);
    return true;
  });
});

test('aborted authentication cannot leave a remembered session', async () => {
  const controller = new AbortController();
  await assert.rejects(authenticateEditorSession({ apiBase, token, signal: controller.signal, fetcher: async () => {
    controller.abort();
    return response({ authenticated: true });
  } }), error => error.name === 'AbortError');
  assert.equal(hasEditorSession(apiBase), false);
});
