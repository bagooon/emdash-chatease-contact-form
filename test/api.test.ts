import { afterEach, describe, expect, it, vi } from 'vitest';
import { admin } from '../src/admin.js';
import { createBoard, workspaceName } from '../src/api.js';
import { formSchema, resolveForm } from '../src/model.js';
import { context, globals, values } from './helpers.js';

const redirects = [301, 302, 303, 307, 308];
const form = () => resolveForm(formSchema.parse({ id: 'contact', name: 'お問い合わせ', usePhone: true }), { apiToken: '', guestPassphrase: '' }, globals);
const redirect = (status: number) => new Response(null, { status, headers: { Location: 'https://redirect-target.example.test/collect' } });

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Workers互換の共通API通信', () => {
  it('接続確認でmanual・認証ヘッダー・POST本文・20秒タイムアウトを維持する', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetcher = vi.fn().mockResolvedValue(Response.json({ name: '接続確認成功' }));
    vi.stubGlobal('fetch', fetcher);
    await expect(workspaceName(globals.apiToken, globals.workspaceSlug)).resolves.toBe('接続確認成功');
    expect(timeout).toHaveBeenCalledExactlyOnceWith(20000);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('https://chatease.jp/api/v1/board/name', {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/json', 'X-Chatease-API-Token': globals.apiToken },
      body: JSON.stringify({ workspaceSlug: globals.workspaceSlug }), signal: expect.any(AbortSignal),
    });
  });

  it('共通設定保存時の接続確認に成功し、ワークスペース名と設定を保存する', async () => {
    const ctx = await context();
    const next = { ...globals, apiToken: 'updated-test-token', workspaceSlug: 'updated-workspace', deadlineDays: 3 };
    const fetcher = vi.fn().mockResolvedValue(Response.json({ name: '更新先ワークスペース' }));
    vi.stubGlobal('fetch', fetcher);
    ctx.input = { type: 'form_submit', action_id: 'save-general', values: next };
    const result = await admin(ctx);
    expect(result.toast?.type).toBe('success');
    for (const [key, value] of Object.entries(next)) expect(await ctx.settings.get(key)).toBe(value);
    expect(await ctx.settings.get('workspaceName')).toBe('更新先ワークスペース');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'manual', headers: { 'X-Chatease-API-Token': next.apiToken } });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ workspaceSlug: next.workspaceSlug });
    expect(JSON.stringify(result)).not.toContain(next.apiToken);
    expect(ctx.email!.send).not.toHaveBeenCalled();
  });

  it('ボード作成でもmanualを使い、既存の認証・payload・タイムアウトを維持する', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-08T00:00:00Z'));
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetcher = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal('fetch', fetcher);
    await createBoard(values, form(), 'workers-board-key');
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('https://chatease.jp/api/v1/board', expect.objectContaining({
      method: 'POST', redirect: 'manual', signal: expect.any(AbortSignal),
      headers: { 'Content-Type': 'application/json', 'X-Chatease-API-Token': globals.apiToken },
    }));
    expect(timeout).toHaveBeenCalledExactlyOnceWith(20000);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      workspaceSlug: globals.workspaceSlug, title: 'フォームからのお問い合わせ',
      guest: { name: 'テスト会社 山田', email: values.email }, boardUniqueKey: 'workers-board-key', memo: 'TEL: 03-1234-5678',
      initialStatus: { statusKey: 'scheduled_for_response', timeLimit: '2026-11-09' }, initialGuestComment: { content: values.message },
    });
  });

  it.each(redirects)('接続確認の%iを拒否し、転送先へ再送しない', async status => {
    const fetcher = vi.fn().mockResolvedValue(redirect(status));
    vi.stubGlobal('fetch', fetcher);
    await expect(workspaceName(globals.apiToken, globals.workspaceSlug)).rejects.toThrow('ChatEase API request failed');
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('https://chatease.jp/api/v1/board/name', expect.objectContaining({ redirect: 'manual' }));
  });

  it.each(redirects)('ボード作成の%iを拒否し、転送先へ再送しない', async status => {
    const fetcher = vi.fn().mockResolvedValue(redirect(status));
    vi.stubGlobal('fetch', fetcher);
    await expect(createBoard(values, form(), 'workers-board-key')).rejects.toThrow('ChatEase API request failed');
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('https://chatease.jp/api/v1/board', expect.objectContaining({ redirect: 'manual' }));
  });

  it.each(redirects)('接続確認が%iでも既存の共通設定・秘密値・ワークスペース名を変更しない', async status => {
    const ctx = await context();
    await ctx.settings.set('workspaceName', '変更前のワークスペース');
    const before = await ctx.settings.list();
    const writes = vi.spyOn(ctx.settings, 'set');
    const fetcher = vi.fn().mockResolvedValue(redirect(status));
    vi.stubGlobal('fetch', fetcher);
    ctx.input = { type: 'form_submit', action_id: 'save-general', values: { ...globals, apiToken: 'new-test-token', workspaceSlug: 'new-workspace', deadlineDays: 7 } };
    expect((await admin(ctx)).toast?.type).toBe('error');
    expect(await ctx.settings.list()).toEqual(before);
    expect(writes).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(ctx.email!.send).not.toHaveBeenCalled();
  });

  it.each(redirects)('専用ワークスペースの接続確認が%iでもフォーム設定を変更しない', async status => {
    const ctx = await context();
    const stored = await ctx.settings.getVersioned<string>('formsData');
    const before = await ctx.settings.list();
    const writes = vi.spyOn(ctx.settings, 'compareAndSet');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(redirect(status)));
    ctx.input = {
      type: 'form_submit', action_id: 'save-form:contact:' + encodeURIComponent(stored!.revision),
      values: { ...formSchema.parse({ id: 'contact', name: '変更後の名前', workspaceSlug: 'private-workspace' }), deadlineDays: '', apiToken: 'private-test-token' },
    };
    expect((await admin(ctx)).toast?.type).toBe('error');
    expect(await ctx.settings.list()).toEqual(before);
    expect(writes).not.toHaveBeenCalled();
    expect(ctx.email!.send).not.toHaveBeenCalled();
  });

  it('接続確認のタイムアウトでも既存設定を変更しない', async () => {
    const ctx = await context();
    const before = await ctx.settings.list();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Timed out', 'TimeoutError')));
    ctx.input = { type: 'form_submit', action_id: 'save-general', values: { ...globals, workspaceSlug: 'new-workspace' } };
    expect((await admin(ctx)).toast?.type).toBe('error');
    expect(await ctx.settings.list()).toEqual(before);
  });
});
