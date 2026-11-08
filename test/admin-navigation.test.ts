import { describe, expect, it } from 'vitest';
import { admin } from '../src/admin.js';
import { formSchema } from '../src/model.js';
import { context } from './helpers.js';

describe('管理画面のフォーム一覧・新規・編集', () => {
  it('一覧メニューを開くと既存フォームを表示し、入力欄を表示しない', async () => {
    const ctx = await context();
    ctx.input = { type: 'page_load', page: '/forms' };
    const page = await admin(ctx);
    expect(page.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'section', text: 'お問い合わせ / ID: contact' }),
      expect.objectContaining({ type: 'section', text: '別フォーム / ID: other' }),
    ]));
    expect(page.blocks.some(b => b.type === 'form')).toBe(false);
  });

  it('未登録でも新規入力画面を勝手に開かず、未登録の案内を表示する', async () => {
    const ctx = await context();
    await ctx.settings.set('formsData', '{}');
    ctx.input = { type: 'page_load', page: '/forms' };
    const page = await admin(ctx);
    expect(page.blocks).toContainEqual({ type: 'section', text: 'フォームがまだありません。「新規フォーム」から作成してください。' });
    expect(page.blocks.some(b => b.type === 'form')).toBe(false);
    expect(page.blocks).toContainEqual(expect.objectContaining({ type: 'actions', elements: [expect.objectContaining({ target: { kind: 'plugin-page', path: '/forms/new' } })] }));
  });

  it('新規フォームから入力画面を開き、戻る操作では保存せず一覧へ戻る', async () => {
    const ctx = await context();
    const before = await ctx.settings.get('formsData');
    ctx.input = { type: 'page_load', page: '/forms/new' };
    const page = await admin(ctx);
    expect(page.blocks).toContainEqual({ type: 'header', text: '新規フォーム' });
    expect(page.blocks.filter(b => b.type === 'form')).toHaveLength(1);
    ctx.input = { type: 'block_action', action_id: 'list-forms' };
    expect((await admin(ctx)).blocks.some(b => b.type === 'form')).toBe(false);
    expect(await ctx.settings.get('formsData')).toEqual(before);
  });

  it('編集では選択したフォームの保存値を読み込み、保存後は一覧を更新する', async () => {
    const ctx = await context();
    ctx.input = { type: 'page_load', page: '/forms/edit/other' };
    const page = await admin(ctx);
    const editor = page.blocks.find(b => b.type === 'form');
    if (!editor || editor.type !== 'form') throw new Error('Missing editor');
    expect(editor.fields).toContainEqual(expect.objectContaining({ action_id: 'id', initial_value: 'other' }));
    ctx.input = { type: 'form_submit', action_id: editor.submit.action_id, values: { ...formSchema.parse({ id: 'other', name: '更新したフォーム', enabled: false }), deadlineDays: '' } };
    const result = await admin(ctx);
    expect(result.toast?.type).toBe('success');
    expect(result.blocks.some(b => b.type === 'form')).toBe(false);
    expect(result.blocks).toContainEqual(expect.objectContaining({ type: 'section', text: '更新したフォーム / ID: other（非公開）' }));
  });

  it('保存エラー時は入力を保持した編集画面と戻る操作を表示する', async () => {
    const ctx = await context();
    ctx.input = { type: 'page_load', page: '/forms/new' };
    const page = await admin(ctx);
    const editor = page.blocks.find(b => b.type === 'form');
    if (!editor || editor.type !== 'form') throw new Error('Missing editor');
    ctx.input = { type: 'form_submit', action_id: editor.submit.action_id, values: { ...formSchema.parse({ id: 'draft', name: '保存前の入力' }), deadlineDays: '', workspaceSlug: 'unpaired-workspace' } };
    const result = await admin(ctx);
    expect(result.toast?.type).toBe('error');
    const retry = result.blocks.find(b => b.type === 'form');
    if (!retry || retry.type !== 'form') throw new Error('Missing retry editor');
    expect(retry.block_id).not.toBe(editor.block_id);
    expect(retry.fields).toContainEqual(expect.objectContaining({ action_id: 'name', initial_value: '保存前の入力' }));
    expect(result.blocks).toContainEqual(expect.objectContaining({ type: 'actions', elements: [expect.objectContaining({ target: { kind: 'plugin-page', path: '/forms' } })] }));
  });

  it('存在しないフォームの編集を新規作成として扱わない', async () => {
    const ctx = await context();
    ctx.input = { type: 'block_action', action_id: 'edit-form', value: 'missing' };
    const result = await admin(ctx);
    expect(result.toast?.type).toBe('error');
    expect(result.blocks.some(b => b.type === 'form')).toBe(false);
  });
});
