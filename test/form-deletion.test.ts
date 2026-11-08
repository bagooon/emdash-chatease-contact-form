import type { BlockResponse } from '@emdash-cms/blocks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { admin } from '../src/admin.js';
import { formSchema } from '../src/model.js';
import { confirm, getPublicForm, publicHandler, submit } from '../src/service.js';
import { context, values } from './helpers.js';

function deleteButton(page: BlockResponse, id: string) {
  for (const block of page.blocks) {
    if (block.type !== 'actions') continue;
    for (const element of block.elements) {
      if (element.type === 'button' && element.action_id === 'delete-form' && typeof element.value === 'object' && element.value !== null && 'id' in element.value && element.value.id === id) return element;
    }
  }
  throw new Error('Missing delete action for ' + id);
}

async function deletion(ctx: Awaited<ReturnType<typeof context>>, id: string) {
  ctx.input = { type: 'page_load', page: '/forms' };
  const button = deleteButton(await admin(ctx), id);
  ctx.input = { type: 'block_action', action_id: button.action_id, value: button.value };
  return admin(ctx);
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('フォームの削除', () => {
  it('対象名・ID・影響を示す確認ダイアログを削除操作に付け、一覧表示ではデータを変更しない', async () => {
    const ctx = await context();
    const before = await ctx.settings.getVersioned('formsData');
    ctx.input = { type: 'page_load', page: '/forms' };
    const button = deleteButton(await admin(ctx), 'contact');
    expect(button.style).toBe('danger');
    expect(button.confirm).toMatchObject({ title: 'フォームを削除しますか？', confirm: '削除する', deny: 'キャンセル', style: 'danger' });
    expect(button.confirm?.text).toContain('お問い合わせ');
    expect(button.confirm?.text).toContain('ID: contact');
    expect(button.confirm?.text).toContain('ChatEaseの既存チャットボードは残ります');
    expect(await ctx.settings.getVersioned('formsData')).toEqual(before);
  });

  it('選択したフォームと専用の秘密値だけを削除し、他フォーム・共通設定と既存ボードを保持する', async () => {
    const ctx = await context();
    const forms = JSON.parse((await ctx.settings.get<string>('formsData'))!);
    forms.contact.secrets = { apiToken: 'form-only-test-token', guestPassphrase: 'form-only-passphrase' };
    await ctx.settings.set('formsData', JSON.stringify(forms));
    const commonBefore = (await ctx.settings.list()).filter(item => item.key !== 'formsData');
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const result = await deletion(ctx, 'contact');
    expect(result.toast?.type).toBe('success');
    const stored = (await ctx.settings.get<string>('formsData'))!;
    const remaining = JSON.parse(stored);
    expect(remaining).not.toHaveProperty('contact');
    expect(remaining.other).toEqual(forms.other);
    expect(stored).not.toMatch(/form-only-test-token|form-only-passphrase/);
    expect((await ctx.settings.list()).filter(item => item.key !== 'formsData')).toEqual(commonBefore);
    expect(fetcher).not.toHaveBeenCalled();
    expect(ctx.email!.send).not.toHaveBeenCalled();
    expect(result.blocks.some(block => block.type === 'form')).toBe(false);
  });

  it('最後のフォームを削除したら未登録の案内を表示する', async () => {
    const ctx = await context();
    const forms = JSON.parse((await ctx.settings.get<string>('formsData'))!);
    await ctx.settings.set('formsData', JSON.stringify({ contact: forms.contact }));
    const result = await deletion(ctx, 'contact');
    expect(result.toast?.type).toBe('success');
    expect(await ctx.settings.get('formsData')).toBe('{}');
    expect(result.blocks).toContainEqual({ type: 'section', text: 'フォームがまだありません。「新規フォーム」から作成してください。' });
  });

  it('古い一覧からの削除で後の更新を削除・上書きしない', async () => {
    const ctx = await context();
    ctx.input = { type: 'page_load', page: '/forms' };
    const button = deleteButton(await admin(ctx), 'contact');
    const forms = JSON.parse((await ctx.settings.get<string>('formsData'))!);
    forms.contact.config.name = '他画面で更新済み';
    await ctx.settings.set('formsData', JSON.stringify(forms));
    const before = await ctx.settings.getVersioned('formsData');
    ctx.input = { type: 'block_action', action_id: button.action_id, value: button.value };
    expect((await admin(ctx)).toast?.type).toBe('error');
    expect(await ctx.settings.getVersioned('formsData')).toEqual(before);
  });

  it('削除直前の競合でも他フォームの変更を失わない', async () => {
    const ctx = await context();
    const concurrent = JSON.parse((await ctx.settings.get<string>('formsData'))!);
    concurrent.other.config.name = '同時更新された別フォーム';
    const compareAndSet = ctx.settings.compareAndSet.bind(ctx.settings);
    vi.spyOn(ctx.settings, 'compareAndSet').mockImplementationOnce(async (key, revision, value) => {
      await ctx.settings.set('formsData', JSON.stringify(concurrent));
      return compareAndSet(key, revision, value);
    });
    expect((await deletion(ctx, 'contact')).toast?.type).toBe('error');
    expect(JSON.parse((await ctx.settings.get<string>('formsData'))!)).toEqual(concurrent);
  });

  it('削除前の編集画面や存在しないIDへの更新でフォームが復活しない', async () => {
    const ctx = await context();
    const old = await ctx.settings.getVersioned('formsData');
    await deletion(ctx, 'contact');
    const current = await ctx.settings.getVersioned('formsData');
    for (const revision of [old!.revision, current!.revision]) {
      ctx.input = { type: 'form_submit', action_id: 'save-form:contact:' + encodeURIComponent(revision), values: { ...formSchema.parse({ id: 'contact', name: '削除前の編集内容' }), deadlineDays: '' } };
      expect((await admin(ctx)).toast?.type).toBe('error');
      expect(await ctx.settings.getVersioned('formsData')).toEqual(current);
    }
  });

  it('削除後は公開設定の取得・入力確認・未送信の確認内容の送信を受け付けない', async () => {
    const ctx = await context();
    ctx.input = { formId: 'contact', values };
    const confirmed = await confirm(ctx);
    await deletion(ctx, 'contact');
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    ctx.input = { formId: 'contact' };
    expect(await getPublicForm(ctx)).toMatchObject({ ok: false });
    ctx.input = { formId: 'contact', values };
    expect(await publicHandler(confirm)(ctx)).toMatchObject({ ok: false });
    ctx.input = { formId: 'contact', token: confirmed.token };
    expect(await publicHandler(submit)(ctx)).toMatchObject({ ok: false });
    expect(fetcher).not.toHaveBeenCalled();
    expect(ctx.email!.send).not.toHaveBeenCalled();
  });

  it.each([null, {}, { id: 'contact' }, { id: '../contact', revision: 'invalid' }])('不正な削除要求%jではデータを変更しない', async value => {
    const ctx = await context();
    const before = await ctx.settings.getVersioned('formsData');
    ctx.input = { type: 'block_action', action_id: 'delete-form', value };
    expect((await admin(ctx)).toast?.type).toBe('error');
    expect(await ctx.settings.getVersioned('formsData')).toEqual(before);
  });
});
