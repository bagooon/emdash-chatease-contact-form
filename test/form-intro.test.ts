import { describe, expect, it } from 'vitest';
import { getPublicForm } from '../src/service.js';
import { context } from './helpers.js';

describe('説明文の連携先ワークスペース名', () => {
  it.each([
    { label: '共通設定を使うフォーム', globalName: '共通ワークスペース', own: false, ownName: '以前の専用名', expected: '共通ワークスペース' },
    { label: '共通名が未取得のフォーム', globalName: '', own: false, ownName: '', expected: '' },
    { label: '専用設定を使うフォーム', globalName: '共通ワークスペース', own: true, ownName: '専用ワークスペース', expected: '専用ワークスペース' },
    { label: '専用名が未取得でも共通名を表示しないフォーム', globalName: '共通ワークスペース', own: true, ownName: undefined, expected: '' },
  ])('$label', async ({ globalName, own, ownName, expected }) => {
    const ctx = await context();
    await ctx.settings.set('workspaceName', globalName);
    const forms = JSON.parse((await ctx.settings.get<string>('formsData'))!);
    forms.contact.workspaceName = ownName;
    if (own) {
      forms.contact.config.workspaceSlug = 'private-workspace';
      forms.contact.secrets.apiToken = 'private-token';
    }
    await ctx.settings.set('formsData', JSON.stringify(forms));
    ctx.input = { formId: 'contact' };
    const result = await getPublicForm(ctx);
    expect(result).toMatchObject({ ok: true, form: { workspaceName: expected } });
    expect(JSON.stringify(result)).not.toMatch(/private-token|test-api-token|admin@example/);
  });
});
