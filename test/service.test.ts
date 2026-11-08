import { afterEach, describe, expect, it, vi } from 'vitest';
import { admin } from '../src/admin.js';
import { createPlugin, chateasePlugin } from '../src/index.js';
import { boardPayload, captchaConfig, deadlineDate, formSchema, publicForm, resolveForm, validateValues } from '../src/model.js';
import { cleanup, confirm, getPublicForm, publicHandler, submit, verifyCaptcha } from '../src/service.js';
import { context, globals, values } from './helpers.js';

const form = () => resolveForm(formSchema.parse({ id: 'contact', name: 'お問い合わせ', usePhone: true }), { apiToken: '', guestPassphrase: '' }, globals);
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('WordPress互換の入力・ボード連携', () => {
  it('会社名と名前・電話メモ・初回投稿・返答期限を送信する', () => {
    const payload = boardPayload(values, form(), 'emdash-key', new Date('2026-11-08T15:30:00Z'));
    expect(payload).toMatchObject({ title: 'フォームからのお問い合わせ', guest: { name: 'テスト会社 山田', email: values.email }, memo: 'TEL: 03-1234-5678', initialGuestComment: { content: values.message }, initialStatus: { statusKey: 'scheduled_for_response', timeLimit: '2026-11-10' } });
    expect(payload).not.toHaveProperty('guestPassphrase');
  });
  it('フォーム専用設定の片方だけを共通設定と組み合わせない', () => {
    expect(() => resolveForm(formSchema.parse({ id: 'contact', name: 'test', workspaceSlug: 'other' }), { apiToken: '', guestPassphrase: '' }, globals)).toThrow('両方');
    const resolved = resolveForm(formSchema.parse({ id: 'contact', name: 'test', workspaceSlug: 'other', deadlineDays: 3, notifyEmail: 'other@example.test' }), { apiToken: 'other-token', guestPassphrase: '合言葉' }, globals);
    expect(resolved).toMatchObject({ workspaceSlug: 'other', apiToken: 'other-token', deadlineDays: 3, notifyEmail: 'other@example.test' });
    expect(boardPayload(values, resolved, 'key').guestPassphrase).toBe('合言葉');
  });
  it('電話欄無効時は改ざんされた電話番号を送らず、必須設定を検証する', () => {
    expect(validateValues(values, { ...form(), usePhone: false }).phone).toBe('');
    expect(() => validateValues({ ...values, phone: '' }, { ...form(), requirePhone: true })).toThrow('電話番号');
    expect(() => validateValues({ ...values, email: 'bad' }, form())).toThrow();
    expect(() => validateValues({ ...values, name: '' }, form())).toThrow();
    expect(() => validateValues({ ...values, message: '' }, form())).toThrow();
  });
  it('サイトのカレンダー日で月末・年末・DST境界を計算する', () => {
    expect(deadlineDate(new Date('2026-12-31T20:00Z'), 1, 'Asia/Tokyo')).toBe('2027-01-02');
    expect(deadlineDate(new Date('2026-03-08T04:30Z'), 1, 'America/New_York')).toBe('2026-03-08');
    expect(deadlineDate(new Date('2028-02-28T00:00Z'), 1, 'UTC')).toBe('2028-02-29');
  });
  it('公開設定にAPIトークン・合言葉・通知先・CAPTCHA秘密鍵を含めない', () => {
    const result = publicForm({ ...form(), guestPassphrase: '秘密', turnstileSiteKey: 'public-key', turnstileSecretKey: 'secret-key' });
    expect(JSON.stringify(result)).not.toMatch(/秘密|test-api-token|secret-key|admin@example/);
    expect(result.captcha).toEqual({ provider: 'turnstile', siteKey: 'public-key' });
  });
});

describe('CAPTCHA', () => {
  it('両方の鍵がそろったTurnstileを優先し、未設定時だけreCAPTCHAへ切り替える', () => {
    const config = { ...globals, turnstileSiteKey: 'site', turnstileSecretKey: 'secret', recaptchaSiteKey: 'google-site', recaptchaSecretKey: 'google-secret' };
    expect(captchaConfig(config).provider).toBe('turnstile');
    expect(captchaConfig({ ...config, turnstileSecretKey: '' }).provider).toBe('recaptcha');
    expect(captchaConfig(globals).provider).toBe('none');
  });
  it('検証成功・失敗・タイムアウト・HTTPエラーを判定する', async () => {
    const config = { ...form(), turnstileSiteKey: 'site', turnstileSecretKey: 'secret' };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true })));
    expect(await verifyCaptcha(config, 'captcha-token', fetcher)).toBe(true);
    expect(fetcher.mock.calls[0][0]).toContain('challenges.cloudflare.com');
    expect(await verifyCaptcha(config, '', fetcher)).toBe(false);
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ success: false })));
    expect(await verifyCaptcha(config, 'bad', fetcher)).toBe(false);
    fetcher.mockRejectedValueOnce(new Error('timeout'));
    expect(await verifyCaptcha(config, 'bad', fetcher)).toBe(false);
    fetcher.mockResolvedValueOnce(new Response('', { status: 503 }));
    expect(await verifyCaptcha(config, 'bad', fetcher)).toBe(false);
  });
  it('CAPTCHA失敗時には確認状態を作成しない', async () => {
    const ctx = await context();
    await ctx.settings.set('turnstileSiteKey', 'site'); await ctx.settings.set('turnstileSecretKey', 'secret');
    ctx.input = { formId: 'contact', values };
    expect(await confirm(ctx)).toMatchObject({ ok: false });
    expect(await ctx.kv.list()).toHaveLength(0);
  });
});

describe('確認と送信', () => {
  it('確認時点では送信せず、確定時に保存した入力のみを送り、完了後は個人情報を消す', async () => {
    const ctx = await context(); const fetcher = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetcher);
    ctx.input = { formId: 'contact', values };
    const confirmation = await confirm(ctx);
    expect(fetcher).not.toHaveBeenCalled();
    ctx.input = { formId: 'contact', token: confirmation.token, values: { message: '改ざん' } };
    expect(await submit(ctx)).toEqual({ ok: true });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ workspaceSlug: globals.workspaceSlug, initialGuestComment: { content: values.message } });
    expect(fetcher.mock.calls[0][1].headers['X-Chatease-API-Token']).toBe(globals.apiToken);
    expect(ctx.email!.send).toHaveBeenCalledOnce();
    expect(JSON.stringify(await ctx.kv.list())).not.toContain(values.email);
    expect(await submit(ctx)).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledOnce(); expect(ctx.email!.send).toHaveBeenCalledOnce();
  });
  it('同時送信で作成処理を一度だけ実行する', async () => {
    const ctx = await context(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    ctx.input = { formId: 'contact', values }; const result = await confirm(ctx);
    ctx.input = { formId: 'contact', token: result.token };
    const responses = await Promise.all([submit(ctx), submit(ctx), submit(ctx)]);
    expect(responses.filter(r => r.ok)).toHaveLength(1);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('通信失敗後に同じboardUniqueKeyで再送する', async () => {
    const ctx = await context(); const fetcher = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetcher);
    ctx.input = { formId: 'contact', values }; const result = await confirm(ctx);
    ctx.input = { formId: 'contact', token: result.token };
    expect(await submit(ctx)).toMatchObject({ ok: false }); expect(ctx.email!.send).not.toHaveBeenCalled();
    expect(await submit(ctx)).toEqual({ ok: true });
    expect(JSON.parse(fetcher.mock.calls[0][1].body).boardUniqueKey).toBe(JSON.parse(fetcher.mock.calls[1][1].body).boardUniqueKey);
  });
  it('通知メール失敗でボード作成をやり直さず完了とし、秘密情報をログに含めない', async () => {
    const ctx = await context(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    vi.mocked(ctx.email!.send).mockRejectedValueOnce(new Error('provider error'));
    ctx.input = { formId: 'contact', values }; const result = await confirm(ctx);
    ctx.input = { formId: 'contact', token: result.token };
    expect(await submit(ctx)).toEqual({ ok: true });
    expect(await submit(ctx)).toEqual({ ok: true }); expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(ctx.log.error).mock.calls)).not.toContain(values.email);
  });
  it('別フォームのトークン・期限切れ・設定変更後の送信を拒否する', async () => {
    const ctx = await context(); ctx.input = { formId: 'contact', values }; const result = await confirm(ctx);
    ctx.input = { formId: 'other', token: result.token }; expect(await submit(ctx)).toMatchObject({ ok: false });
    await ctx.settings.set('deadlineDays', 2);
    ctx.input = { formId: 'contact', token: result.token }; expect(await submit(ctx)).toMatchObject({ ok: false, expired: true });
    vi.useFakeTimers(); vi.advanceTimersByTime(16 * 60 * 1000);
    expect(await submit(ctx)).toMatchObject({ ok: false, expired: true });
    await cleanup(ctx); expect(await ctx.kv.list()).toHaveLength(0);
  });
  it('アダプターの内部Request URLではなく公開サイトのOriginを照合する', async () => {
    const ctx = await context();
    ctx.request = new Request('http://localhost:4327/_emdash/api/plugins/chatease-contact-form/confirm', { headers: { origin: 'https://site.example.test' } });
    ctx.input = { formId: 'contact', values };
    expect(await confirm(ctx)).toMatchObject({ ok: true });
    ctx.request = new Request(ctx.request.url, { headers: { origin: 'http://localhost:4327' } });
    expect(await publicHandler(confirm)(ctx)).toMatchObject({ ok: false });
  });
  it('他オリジン・Origin欠落・確認なしの送信を拒否する', async () => {
    const ctx = await context(); ctx.input = { formId: 'contact', token: crypto.randomUUID() };
    expect(await submit(ctx)).toMatchObject({ ok: false });
    ctx.request = new Request(ctx.request.url, { headers: { origin: 'https://other.test' } });
    expect(await publicHandler(confirm)(ctx)).toMatchObject({ ok: false });
    ctx.request = new Request(ctx.request.url);
    expect(await publicHandler(confirm)(ctx)).toMatchObject({ ok: false });
  });
  it('存在しない・無効フォームを公開しない', async () => {
    const ctx = await context(); ctx.input = { formId: 'missing' };
    expect(await getPublicForm(ctx)).toMatchObject({ ok: false });
    const stored = await ctx.settings.get<string>('formsData'); const data = JSON.parse(stored!);
    data.contact.config.enabled = false; await ctx.settings.set('formsData', JSON.stringify(data));
    ctx.input = { formId: 'contact' }; expect(await getPublicForm(ctx)).toMatchObject({ ok: false });
  });
});

describe('EmDashの登録と管理画面', () => {
  it('フォーム切替時にBlock Kitの入力状態を引き継がない識別子を返す', async () => {
    const ctx = await context();
    ctx.input = { type: 'block_action', action_id: 'new-form' }; const createPage = await admin(ctx);
    ctx.input = { type: 'block_action', action_id: 'edit-form', value: 'contact' }; const editPage = await admin(ctx);
    const createForm = createPage.blocks.find(b => b.type === 'form');
    const editForm = editPage.blocks.find(b => b.type === 'form');
    expect(createForm?.type).toBe('form');
    expect(editForm?.type).toBe('form');
    expect(createForm?.block_id).not.toBe(editForm?.block_id);
  });
  it('古い編集画面からの保存で別の更新を上書きしない', async () => {
    const ctx = await context(); ctx.input = { type: 'block_action', action_id: 'new-form' };
    const page = await admin(ctx); const editor = page.blocks.find(b => b.type === 'form');
    if (!editor || editor.type !== 'form') throw new Error('Missing editor');
    const current = (await ctx.settings.get<string>('formsData'))!;
    await ctx.settings.set('formsData', current);
    ctx.input = { type: 'form_submit', action_id: editor.submit.action_id, values: { id: 'another', name: '新規' } };
    expect((await admin(ctx)).toast?.type).toBe('error');
    expect(await ctx.settings.get('formsData')).toBe(current);
  });
  it('秘密値を明示解除できるが、フォーム固有の認証情報が片方だけなら保存しない', async () => {
    const ctx = await context();
    ctx.input = { type: 'block_action', action_id: 'edit-form', value: 'contact' };
    const page = await admin(ctx); const editor = page.blocks.find(b => b.type === 'form');
    if (!editor || editor.type !== 'form') throw new Error('Missing editor');
    ctx.input = { type: 'form_submit', action_id: editor.submit.action_id, values: { ...formSchema.parse({ id: 'contact', name: 'お問い合わせ' }), deadlineDays: '', workspaceSlug: 'other' } };
    expect((await admin(ctx)).toast?.type).toBe('error');
    const data = JSON.parse((await ctx.settings.get<string>('formsData'))!);
    data.contact.secrets.guestPassphrase = '合言葉';
    await ctx.settings.set('formsData', JSON.stringify(data));
    ctx.input = { type: 'block_action', action_id: 'edit-form', value: 'contact' };
    const updatedPage = await admin(ctx); const updatedEditor = updatedPage.blocks.find(b => b.type === 'form');
    if (!updatedEditor || updatedEditor.type !== 'form') throw new Error('Missing editor');
    ctx.input = { type: 'form_submit', action_id: updatedEditor.submit.action_id, values: { ...data.contact.config, deadlineDays: '', clearGuestPassphrase: true } };
    expect((await admin(ctx)).toast?.type).toBe('success');
    expect(JSON.parse((await ctx.settings.get<string>('formsData'))!).contact.secrets.guestPassphrase).toBe('');
  });
  it('ネイティブ登録・ブロック・公開/非公開ルートの契約がそろう', () => {
    const descriptor = chateasePlugin(); const plugin = createPlugin();
    expect(descriptor.format).toBe('native'); expect(descriptor.id).toBe(plugin.id);
    expect(descriptor.portableTextBlocks?.[0].type).toBe('chateaseContactForm');
    expect(plugin.routes.admin.permission).toBe('plugins:manage'); expect(plugin.routes.admin.public).not.toBe(true);
    expect(plugin.routes.submit.methods).toEqual(['POST']);
    expect(plugin.admin.settingsSchema?.formsData.type).toBe('secret');
  });
  it('管理画面にも既存の秘密情報を返さず、空の秘密入力では保存値を消さない', async () => {
    const ctx = await context();
    ctx.input = { type: 'page_load', page: '/general' }; expect(JSON.stringify(await admin(ctx))).not.toContain(globals.apiToken);
    ctx.input = { type: 'block_action', action_id: 'new-form' }; const page = await admin(ctx);
    const editor = page.blocks.find(b => b.type === 'form');
    if (!editor || editor.type !== 'form') throw new Error('Missing form');
    ctx.input = { type: 'form_submit', action_id: editor.submit.action_id, values: { ...formSchema.parse({ id: 'new-contact', name: '新規' }), deadlineDays: '', apiToken: '', guestPassphrase: '合言葉' } };
    const result = await admin(ctx); expect(result.toast?.type).toBe('success');
    expect(JSON.stringify(result)).not.toContain('合言葉');
    const data = JSON.parse((await ctx.settings.get<string>('formsData'))!); expect(data['new-contact'].secrets.guestPassphrase).toBe('合言葉');
    expect(result.blocks.some(b => b.type === 'form')).toBe(false);
    ctx.input = { type: 'block_action', action_id: 'edit-form', value: 'new-contact' };
    const editPage = await admin(ctx);
    const edit = editPage.blocks.find(b => b.type === 'form');
    if (!edit || edit.type !== 'form') throw new Error('Missing editor');
    ctx.input = { type: 'form_submit', action_id: edit.submit.action_id, values: { ...data['new-contact'].config, deadlineDays: '', apiToken: '', guestPassphrase: '' } };
    expect((await admin(ctx)).toast?.type).toBe('success');
    expect(JSON.parse((await ctx.settings.get<string>('formsData'))!)['new-contact'].secrets.guestPassphrase).toBe('合言葉');
  });
});
