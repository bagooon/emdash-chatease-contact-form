import type { PluginContext, SettingField } from 'emdash';
import { formSchema, resolveForm, type FormConfig, type FormSecrets, type GlobalSettings } from './model.js';

export const settingsSchema = {
  apiToken: { type: 'secret', label: 'ChatEase APIトークン' },
  workspaceSlug: { type: 'string', label: 'ワークスペーススラッグ' },
  deadlineDays: { type: 'number', label: '返答期限（日数）', default: 1, min: 1, max: 3650 },
  notifyEmail: { type: 'email', label: '通知先メールアドレス' },
  timezone: { type: 'string', label: 'タイムゾーン', default: 'Asia/Tokyo' },
  turnstileSiteKey: { type: 'string', label: 'Turnstile Site Key' },
  turnstileSecretKey: { type: 'secret', label: 'Turnstile Secret Key' },
  recaptchaSiteKey: { type: 'string', label: 'reCAPTCHA v2 Site Key' },
  recaptchaSecretKey: { type: 'secret', label: 'reCAPTCHA v2 Secret Key' },
  formsData: { type: 'secret', label: 'フォーム設定', description: 'フォーム一覧から編集してください。' },
} satisfies Record<string, SettingField>;

export interface StoredForm { config: FormConfig; secrets: FormSecrets; workspaceName?: string }
export type Forms = Record<string, StoredForm>;

export async function readGlobals(ctx: PluginContext): Promise<GlobalSettings> {
  const keys = Object.keys(settingsSchema).filter(k => k !== 'formsData');
  const values = await Promise.all(keys.map(async k => [k, await ctx.settings.get(k)] as const));
  const settings = Object.fromEntries(values);
  return {
    apiToken: String(settings.apiToken ?? ''), workspaceSlug: String(settings.workspaceSlug ?? ''),
    deadlineDays: Number(settings.deadlineDays ?? 1), notifyEmail: String(settings.notifyEmail ?? ''),
    timezone: String(settings.timezone ?? 'Asia/Tokyo'),
    turnstileSiteKey: String(settings.turnstileSiteKey ?? ''), turnstileSecretKey: String(settings.turnstileSecretKey ?? ''),
    recaptchaSiteKey: String(settings.recaptchaSiteKey ?? ''), recaptchaSecretKey: String(settings.recaptchaSecretKey ?? ''),
  };
}

export async function readForms(ctx: PluginContext) {
  const stored = await ctx.settings.getVersioned<string>('formsData');
  const forms: Forms = stored ? JSON.parse(stored.value) : {};
  return { forms, revision: stored?.revision ?? null };
}

export async function readForm(ctx: PluginContext, id: string) {
  const { forms } = await readForms(ctx);
  if (!Object.hasOwn(forms, id) || !forms[id].config.enabled) throw new Error('フォームは現在ご利用いただけません。');
  const entry = forms[id];
  const form = resolveForm(formSchema.parse(entry.config), entry.secrets, await readGlobals(ctx));
  const workspaceName = entry.secrets.apiToken
    ? entry.workspaceName
    : await ctx.settings.get<string>('workspaceName');
  return { ...form, workspaceName: workspaceName?.trim() ?? '' };
}

export async function fingerprint(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
