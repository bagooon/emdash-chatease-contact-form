import { z } from 'zod';

export const PLUGIN_ID = 'chatease-contact-form';
export const PACKAGE_NAME = '@bagooon/chatease-emdash-plugin';
export const VERSION = '0.2.0';
export const API_PATH = `/_emdash/api/plugins/${PLUGIN_ID}`;

const line = (max: number) => z.string().trim().max(max).refine(v => !/[\r\n\u0000]/u.test(v));
export const formSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  name: line(200).min(1),
  enabled: z.boolean().default(true),
  labelCompany: line(100).default('会社名'),
  labelName: line(100).default('お名前'),
  labelEmail: line(100).default('メールアドレス'),
  labelMessage: line(100).default('お問い合わせ内容'),
  usePhone: z.boolean().default(false),
  requirePhone: z.boolean().default(false),
  usePluginStyle: z.boolean().default(true),
  boardTitle: line(200).default(''),
  deadlineDays: z.number().int().min(1).max(3650).nullable().default(null),
  notifyEmail: z.union([z.literal(''), z.email()]).default(''),
  workspaceSlug: line(128).default(''),
});
export type FormConfig = z.infer<typeof formSchema>;
export interface FormSecrets { apiToken: string; guestPassphrase: string }
export interface GlobalSettings {
  apiToken: string;
  workspaceSlug: string;
  deadlineDays: number;
  notifyEmail: string;
  timezone: string;
  turnstileSiteKey: string;
  turnstileSecretKey: string;
  recaptchaSiteKey: string;
  recaptchaSecretKey: string;
}
export interface ResolvedForm extends Omit<FormConfig, 'deadlineDays'>, FormSecrets, GlobalSettings {
  workspaceName?: string;
}
export const valuesSchema = z.object({
  company: line(200).default(''),
  name: line(200).min(1, 'お名前を入力してください。'),
  email: z.email('正しいメールアドレスを入力してください。').max(254),
  phone: line(100).default(''),
  message: z.string().trim().min(1, 'お問い合わせ内容を入力してください。').max(20000).refine(v => !v.includes('\0')),
});
export type FormValues = z.infer<typeof valuesSchema>;

export function resolveForm(form: FormConfig, secrets: FormSecrets, global: GlobalSettings): ResolvedForm {
  if (Boolean(secrets.apiToken) !== Boolean(form.workspaceSlug)) {
    throw new Error('フォーム専用のAPIトークンとワークスペーススラッグは両方設定してください。');
  }
  const resolved = {
    ...global, ...form, ...secrets,
    apiToken: secrets.apiToken || global.apiToken,
    workspaceSlug: form.workspaceSlug || global.workspaceSlug,
    deadlineDays: form.deadlineDays ?? global.deadlineDays,
    notifyEmail: form.notifyEmail || global.notifyEmail,
    boardTitle: form.boardTitle || 'フォームからのお問い合わせ',
  };
  if (!resolved.apiToken || !resolved.workspaceSlug) throw new Error('ChatEase連携が未設定です。');
  if (!resolved.notifyEmail || !z.email().safeParse(resolved.notifyEmail).success) throw new Error('通知先メールアドレスを設定してください。');
  if (!Number.isInteger(resolved.deadlineDays) || resolved.deadlineDays < 1 || resolved.deadlineDays > 3650) throw new Error('返答期限は1〜3650日で設定してください。');
  new Intl.DateTimeFormat('en', { timeZone: resolved.timezone }).format();
  return resolved;
}

export function captchaConfig(settings: GlobalSettings) {
  if (settings.turnstileSiteKey && settings.turnstileSecretKey) return { provider: 'turnstile', siteKey: settings.turnstileSiteKey } as const;
  if (settings.recaptchaSiteKey && settings.recaptchaSecretKey) return { provider: 'recaptcha', siteKey: settings.recaptchaSiteKey } as const;
  return { provider: 'none', siteKey: '' } as const;
}

// Explicit allowlist: credentials and the guest passphrase never enter public JSON.
export function publicForm(form: ResolvedForm) {
  return {
    id: form.id,
    workspaceName: form.workspaceName ?? '',
    labels: { company: form.labelCompany || '会社名', name: form.labelName || 'お名前', email: form.labelEmail || 'メールアドレス', phone: '電話番号', message: form.labelMessage || 'お問い合わせ内容' },
    usePhone: form.usePhone, requirePhone: form.usePhone && form.requirePhone,
    usePluginStyle: form.usePluginStyle, captcha: captchaConfig(form),
  };
}

export function validateValues(input: unknown, form: FormConfig): FormValues {
  const values = valuesSchema.parse(input);
  if (!form.usePhone) values.phone = '';
  if (form.usePhone && form.requirePhone && !values.phone) throw new Error('電話番号を入力してください。');
  return values;
}

export function deadlineDate(now: Date, days: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => Number(parts.find(p => p.type === type)?.value);
  const date = new Date(Date.UTC(part('year'), part('month') - 1, part('day') + days));
  return date.toISOString().slice(0, 10);
}

export function boardPayload(values: FormValues, form: ResolvedForm, key: string, now = new Date()) {
  return {
    title: form.boardTitle,
    guest: { name: [values.company, values.name].filter(Boolean).join(' '), email: values.email },
    boardUniqueKey: key,
    memo: values.phone ? `TEL: ${values.phone}` : '',
    initialStatus: { statusKey: 'scheduled_for_response', timeLimit: deadlineDate(now, form.deadlineDays, form.timezone) },
    initialGuestComment: { content: values.message },
    ...(form.guestPassphrase ? { guestPassphrase: form.guestPassphrase } : {}),
  };
}

export function notificationText(values: FormValues): string {
  return `Webフォームからお問い合わせがありました。\n\n会社名: ${values.company || '（未入力）'}\nお名前: ${values.name}\nメールアドレス: ${values.email}\n電話番号: ${values.phone || '（未入力）'}\nお問い合わせ内容:\n${values.message}\n`;
}
