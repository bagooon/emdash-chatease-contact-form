import type { BlockResponse, FormField } from '@emdash-cms/blocks';
import type { PluginContext, RouteContext } from 'emdash';
import { z } from 'zod';
import { workspaceName } from './api.js';
import { formSchema, type FormSecrets } from './model.js';
import { readForms, readGlobals, settingsSchema } from './store.js';

const interactionSchema = z.object({
  type: z.enum(['page_load', 'form_submit', 'block_action']),
  page: z.string().optional(), action_id: z.string().optional(), value: z.unknown().optional(),
  values: z.record(z.string(), z.unknown()).optional(),
});
const text = (key: string, label: string, value = ''): FormField => ({ type: 'text_input', action_id: key, label, initial_value: value });
const toggle = (key: string, label: string, value = false): FormField => ({ type: 'toggle', action_id: key, label, initial_value: value });
const secret = (key: string, label: string, hasValue: boolean): FormField => ({ type: 'secret_input', action_id: key, label, has_value: hasValue });
const secretKeys = ['apiToken', 'turnstileSecretKey', 'recaptchaSecretKey'] as const;
const formDeletionSchema = z.object({ id: formSchema.shape.id, revision: z.string().min(1) });
const conflictMessage = '別の画面で設定が更新されました。一覧を開き直してください。';

async function generalPage(ctx: PluginContext): Promise<BlockResponse> {
  const settings = await readGlobals(ctx);
  const fields: FormField[] = [];
  for (const [key, field] of Object.entries(settingsSchema)) {
    if (key === 'formsData') continue;
    const value = settings[key as keyof typeof settings];
    if (field.type === 'secret') {
      fields.push(secret(key, field.label, Boolean(value)), toggle(`clear_${key}`, `${field.label}を解除`));
    } else if (field.type === 'number') {
      fields.push({ type: 'number_input', action_id: key, label: field.label, initial_value: Number(value), min: 1, max: 3650 });
    } else fields.push(text(key, field.label, String(value)));
  }
  const name = await ctx.settings.get<string>('workspaceName');
  const revision = (await ctx.settings.getVersioned('timezone'))?.revision ?? 'new';
  return { blocks: [
    { type: 'header', text: 'ChatEase 共通設定' },
    { type: 'section', text: name ? `連携先ワークスペース: ${name}` : 'APIトークンとワークスペーススラッグを設定してください。' },
    { type: 'form', block_id: `general-${revision}`, fields, submit: { label: '保存', action_id: 'save-general' } },
  ] };
}

async function formsListPage(ctx: PluginContext): Promise<BlockResponse> {
  const { forms, revision } = await readForms(ctx);
  const entries = Object.values(forms);
  return { blocks: [
    { type: 'header', text: 'ChatEase フォーム一覧' },
    { type: 'section', text: '本文の「ChatEase お問い合わせフォーム」ブロックにフォームIDを指定すると設置できます。' },
    { type: 'actions', elements: [{ type: 'link', label: '新規フォーム', appearance: 'primary', target: { kind: 'plugin-page', path: '/forms/new' } }] },
    { type: 'divider', block_id: 'forms-list-start' },
    ...entries.flatMap((f, index): BlockResponse['blocks'] => [
      ...(index ? [{ type: 'divider' as const, block_id: `form-divider-${f.config.id}` }] : []),
      { type: 'section', block_id: `form-summary-${f.config.id}`, text: `${f.config.name} / ID: ${f.config.id}${f.config.enabled ? '' : '（非公開）'}` },
      { type: 'actions', block_id: `form-actions-${f.config.id}`, elements: [
        { type: 'link', label: '編集', appearance: 'secondary', target: { kind: 'plugin-page', path: `/forms/edit/${f.config.id}` } },
        { type: 'button', action_id: 'delete-form', label: '削除', style: 'danger', value: { id: f.config.id, revision }, confirm: {
          title: 'フォームを削除しますか？',
          text: `「${f.config.name}」（ID: ${f.config.id}）を削除します。設置済みのページでこのフォームを利用できなくなります。削除は取り消せません。ChatEaseの既存チャットボードは残ります。`,
          confirm: '削除する', deny: 'キャンセル', style: 'danger',
        } },
      ] },
    ]),
    ...(!entries.length ? [{ type: 'section' as const, text: 'フォームがまだありません。「新規フォーム」から作成してください。' }] : []),
  ] };
}

async function formEditorPage(ctx: PluginContext, editId?: string, draft?: Record<string, unknown>): Promise<BlockResponse> {
  const { forms, revision } = await readForms(ctx);
  const entry = editId && Object.hasOwn(forms, editId) ? forms[editId] : undefined;
  if (editId && !entry) throw new Error('フォームが見つかりません。一覧を開き直してください。');
  const config = { ...formSchema.parse({ id: 'contact', name: 'お問い合わせ' }), ...entry?.config, ...draft };
  const fields: FormField[] = [
    text('id', 'フォームID（英小文字・数字・ハイフン。保存後の変更不可）', String(config.id)),
    text('name', 'フォーム名', String(config.name)),
    toggle('enabled', 'フォームを公開する', Boolean(config.enabled)),
    text('labelCompany', '会社名ラベル', String(config.labelCompany)),
    text('labelName', 'お名前ラベル', String(config.labelName)),
    text('labelEmail', 'メールアドレスラベル', String(config.labelEmail)),
    text('labelMessage', 'お問い合わせ内容ラベル', String(config.labelMessage)),
    toggle('usePhone', '電話番号入力欄を表示', Boolean(config.usePhone)),
    toggle('requirePhone', '電話番号を必須にする', Boolean(config.requirePhone)),
    toggle('usePluginStyle', 'プラグイン同梱スタイルを適用', Boolean(config.usePluginStyle)),
    text('boardTitle', 'チャットボードタイトル（空欄: フォームからのお問い合わせ）', String(config.boardTitle)),
    text('deadlineDays', '返答期限（日数・空欄は共通設定）', String(config.deadlineDays ?? '')),
    text('notifyEmail', '通知先メールアドレス（空欄は共通設定）', String(config.notifyEmail)),
    text('workspaceSlug', 'フォーム専用ワークスペーススラッグ', String(config.workspaceSlug)),
    secret('apiToken', 'フォーム専用APIトークン', Boolean(entry?.secrets.apiToken)),
    toggle('clearApiToken', 'フォーム専用APIトークンを解除'),
    secret('guestPassphrase', 'ゲスト用あいことば', Boolean(entry?.secrets.guestPassphrase)),
    toggle('clearGuestPassphrase', 'ゲスト用あいことばを解除'),
  ];
  return { blocks: [
    { type: 'actions', elements: [{ type: 'link', label: '一覧に戻る', appearance: 'secondary', target: { kind: 'plugin-page', path: '/forms' } }] },
    { type: 'header', text: entry ? `${entry.config.name}の編集` : '新規フォーム' },
    ...(entry?.workspaceName ? [{ type: 'section' as const, text: `連携先ワークスペース: ${entry.workspaceName}` }] : []),
    { type: 'form', block_id: `form-editor-${editId ?? 'new'}-${draft ? crypto.randomUUID() : revision ?? 'new'}`, fields, submit: { label: '保存', action_id: `save-form:${editId ?? ''}:${encodeURIComponent(revision ?? '')}` } },
  ] };
}

async function saveGeneral(ctx: PluginContext, values: Record<string, unknown>) {
  const previous = await readGlobals(ctx);
  const next = { ...previous };
  for (const key of Object.keys(previous) as (keyof typeof previous)[]) {
    if (secretKeys.includes(key as typeof secretKeys[number])) {
      if (values[`clear_${key}`] === true) Object.assign(next, { [key]: '' });
      else if (typeof values[key] === 'string' && values[key].trim()) Object.assign(next, { [key]: values[key].trim() });
    } else if (key === 'deadlineDays') next.deadlineDays = z.coerce.number().int().min(1).max(3650).parse(values[key]);
    else Object.assign(next, { [key]: z.string().max(1000).parse(values[key]).trim() });
  }
  if (next.notifyEmail) z.email().parse(next.notifyEmail);
  new Intl.DateTimeFormat('en', { timeZone: next.timezone }).format();
  if (Boolean(next.apiToken) !== Boolean(next.workspaceSlug)) throw new Error('APIトークンとワークスペーススラッグは両方設定してください。');
  const name = next.apiToken ? await workspaceName(next.apiToken, next.workspaceSlug) : '';
  for (const [key, value] of Object.entries(next)) await ctx.settings.set(key, value);
  await ctx.settings.set('workspaceName', name);
}

async function deleteForm(ctx: PluginContext, input: unknown): Promise<void> {
  const requested = formDeletionSchema.parse(input);
  const { forms, revision } = await readForms(ctx);
  if (revision !== requested.revision) throw new Error(conflictMessage);
  if (!Object.hasOwn(forms, requested.id)) throw new Error('フォームが見つかりません。一覧を開き直してください。');
  delete forms[requested.id];
  const result = await ctx.settings.compareAndSet('formsData', revision, JSON.stringify(forms));
  if (!result.applied) throw new Error(conflictMessage);
}

async function saveForm(ctx: PluginContext, action: string, values: Record<string, unknown>) {
  const [, originalId, encodedRevision] = action.split(':');
  const expectedRevision = decodeURIComponent(encodedRevision) || null;
  const { forms, revision } = await readForms(ctx);
  if (revision !== expectedRevision) throw new Error(conflictMessage);
  if (originalId && !Object.hasOwn(forms, originalId)) throw new Error('フォームが見つかりません。一覧を開き直してください。');
  const config = formSchema.parse({ ...values, deadlineDays: values.deadlineDays === '' || values.deadlineDays == null ? null : Number(values.deadlineDays) });
  if (originalId && originalId !== config.id) throw new Error('保存済みフォームのIDは変更できません。');
  if (!originalId && Object.hasOwn(forms, config.id)) throw new Error('同じフォームIDが既に存在します。');
  if (!originalId && Object.keys(forms).length >= 100) throw new Error('フォームは100件まで作成できます。');
  const previous = originalId && Object.hasOwn(forms, originalId) ? forms[originalId].secrets : { apiToken: '', guestPassphrase: '' };
  const secrets: FormSecrets = { ...previous };
  for (const key of ['apiToken', 'guestPassphrase'] as const) {
    const clearKey = key === 'apiToken' ? 'clearApiToken' : 'clearGuestPassphrase';
    if (values[clearKey] === true) secrets[key] = '';
    else if (typeof values[key] === 'string' && values[key].trim()) secrets[key] = values[key].trim();
  }
  if (Array.from(secrets.guestPassphrase).reduce((n, c) => n + (c.charCodeAt(0) <= 255 ? 1 : 2), 0) > 20) throw new Error('あいことばは全角10文字相当以内で設定してください。');
  if (Boolean(secrets.apiToken) !== Boolean(config.workspaceSlug)) throw new Error('フォーム専用のAPIトークンとワークスペーススラッグは両方設定してください。');
  const name = secrets.apiToken ? await workspaceName(secrets.apiToken, config.workspaceSlug) : '';
  forms[config.id] = { config, secrets, workspaceName: name };
  const saved = await ctx.settings.compareAndSet('formsData', revision, JSON.stringify(forms));
  if (!saved.applied) throw new Error(conflictMessage);
  return config.id;
}

export async function admin(ctx: RouteContext): Promise<BlockResponse> {
  const input = interactionSchema.parse(ctx.input);
  const action = input.action_id ?? '';
  let editId: string | undefined;
  try {
    if (input.type === 'page_load' && input.page === '/general') return generalPage(ctx);
    if (input.type === 'page_load' && input.page === '/forms/new') return await formEditorPage(ctx);
    if (input.type === 'page_load' && input.page?.startsWith('/forms/edit/')) {
      editId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).parse(input.page.slice('/forms/edit/'.length));
      return await formEditorPage(ctx, editId);
    }
    if (input.type === 'form_submit' && action === 'save-general') {
      await saveGeneral(ctx, input.values ?? {});
      return { ...await generalPage(ctx), toast: { message: '共通設定を保存しました。', type: 'success' } };
    }
    if (input.type === 'block_action' && action === 'delete-form') {
      await deleteForm(ctx, input.value);
      return { ...await formsListPage(ctx), toast: { message: 'フォームを削除しました。', type: 'success' } };
    }
    if (input.type === 'block_action' && action === 'new-form') return await formEditorPage(ctx);
    if (input.type === 'block_action' && action === 'edit-form') {
      editId = z.string().parse(input.value);
      return await formEditorPage(ctx, editId);
    }
    if (input.type === 'form_submit' && action.startsWith('save-form:')) {
      editId = action.split(':')[1] || undefined;
      await saveForm(ctx, action, input.values ?? {});
      return { ...await formsListPage(ctx), toast: { message: 'フォームを保存しました。', type: 'success' } };
    }
    return formsListPage(ctx);
  } catch (error) {
    const message = error instanceof z.ZodError ? '入力内容を確認してください。' : error instanceof Error && !error.message.includes('API') ? error.message : 'ワークスペースを確認できません。APIトークンとスラッグを確認してください。';
    const page = action === 'save-general'
      ? await generalPage(ctx)
      : input.type === 'form_submit' && action.startsWith('save-form:')
        ? await formEditorPage(ctx, editId, input.values).catch(() => formsListPage(ctx))
        : await formsListPage(ctx);
    return { ...page, toast: { message, type: 'error' } };
  }
}
