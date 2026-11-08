import { createBoard } from './api.js';
import type { PluginContext, RouteContext } from 'emdash';
import { z } from 'zod';
import { captchaConfig, notificationText, publicForm, validateValues, type FormValues, type ResolvedForm } from './model.js';
import { fingerprint, readForm } from './store.js';

const idSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const confirmationSchema = z.object({ formId: idSchema, values: z.unknown(), captchaToken: z.string().max(8192).default('') });
const submitSchema = z.object({ formId: idSchema, token: z.uuid() });
const LIFETIME = 15 * 60 * 1000;
const LEASE = 60 * 1000;
interface Pending {
  formId: string;
  fingerprint: string;
  values?: FormValues;
  expires: number;
  status: 'confirmed' | 'sending' | 'complete';
  lease?: number;
  boardCreated?: boolean;
}

export type Fetch = typeof fetch;
export async function verifyCaptcha(form: ResolvedForm, token: string, fetcher: Fetch = fetch): Promise<boolean> {
  const { provider } = captchaConfig(form);
  if (provider === 'none') return true;
  if (!token) return false;
  const url = provider === 'turnstile' ? 'https://challenges.cloudflare.com/turnstile/v0/siteverify' : 'https://www.google.com/recaptcha/api/siteverify';
  const secret = provider === 'turnstile' ? form.turnstileSecretKey : form.recaptchaSecretKey;
  try {
    const response = await fetcher(url, { method: 'POST', body: new URLSearchParams({ secret, response: token }), signal: AbortSignal.timeout(10000) });
    if (!response.ok) return false;
    const result: unknown = await response.json();
    return z.object({ success: z.literal(true) }).safeParse(result).success;
  } catch { return false; }
}

function assertSameOrigin(ctx: RouteContext): void {
  const origin = ctx.request.headers.get('origin');
  // Node adapters may normalize Request.url to the internal listener.
  // EmDash's site URL is the configured public origin.
  if (!origin || origin !== new URL(ctx.site.url).origin) throw new Error('不正な送信です。ページを再読み込みしてください。');
}

export async function getPublicForm(ctx: RouteContext) {
  const { formId } = z.object({ formId: idSchema }).parse(ctx.input);
  try { return { ok: true, form: publicForm(await readForm(ctx, formId)) }; }
  catch { return { ok: false, error: 'フォームは現在ご利用いただけません。' }; }
}

export async function confirm(ctx: RouteContext) {
  assertSameOrigin(ctx);
  const { formId, captchaToken, values: input } = confirmationSchema.parse(ctx.input);
  const form = await readForm(ctx, formId);
  const values = validateValues(input, form);
  if (!await verifyCaptcha(form, captchaToken)) return { ok: false, error: 'スパム対策の認証に失敗しました。もう一度お試しください。' };
  const token = crypto.randomUUID();
  const state: Pending = { formId, fingerprint: await fingerprint(form), values, expires: Date.now() + LIFETIME, status: 'confirmed' };
  await ctx.kv.set(`state:submission:${token}`, state);
  return { ok: true, token, values };
}

export async function submit(ctx: RouteContext) {
  assertSameOrigin(ctx);
  const { formId, token } = submitSchema.parse(ctx.input);
  const key = `state:submission:${token}`;
  const stored = await ctx.kv.getVersioned<Pending>(key);
  if (!stored || stored.value.formId !== formId || stored.value.expires <= Date.now()) return { ok: false, error: '確認の有効期限が切れました。もう一度入力してください。', expired: true };
  const pending = stored.value;
  if (pending.status === 'complete') return { ok: true };
  if (pending.status === 'sending' && (pending.lease ?? 0) > Date.now()) return { ok: false, error: '送信処理中です。少し待ってから再度お試しください。' };
  const form = await readForm(ctx, formId);
  if (pending.fingerprint !== await fingerprint(form)) return { ok: false, error: 'フォーム設定が更新されました。もう一度入力してください。', expired: true };
  if (!pending.values) return { ok: false, error: '入力内容が見つかりません。もう一度入力してください。', expired: true };
  const locked = await ctx.kv.compareAndSet(key, stored.revision, { ...pending, status: 'sending', lease: Date.now() + LEASE });
  if (!locked.applied) return { ok: false, error: '送信処理中です。少し待ってから再度お試しください。' };
  let revision = locked.revision;
  try {
    if (!pending.boardCreated) {
      await createBoard(pending.values, form, `emdash-${token}`);
      pending.boardCreated = true;
      const checkpoint = await ctx.kv.compareAndSet(key, revision, { ...pending, status: 'sending', lease: Date.now() + LEASE });
      if (!checkpoint.applied) return { ok: false, error: '送信状況を確認しています。少し待ってから再度お試しください。' };
      revision = checkpoint.revision;
    }
    try {
      if (!ctx.email) throw new Error('Email provider unavailable');
      await ctx.email.send({ to: form.notifyEmail, subject: '【ChatEase】Webフォームからのお問い合わせ', text: notificationText(pending.values) });
    } catch {
      // A created board is a successful submission, matching WordPress wp_mail behavior.
      ctx.log.error('ChatEase administrator notification failed', { formId });
    }
    await ctx.kv.compareAndSet(key, revision, { formId, fingerprint: pending.fingerprint, expires: pending.expires, status: 'complete' });
    return { ok: true };
  } catch {
    await ctx.kv.compareAndSet(key, revision, { ...pending, status: 'confirmed', lease: undefined });
    ctx.log.error('ChatEase board submission failed', { formId });
    return { ok: false, error: '送信に失敗しました。少し待ってから再度お試しください。' };
  }
}

export async function cleanup(ctx: PluginContext) {
  const items = await ctx.kv.list('state:submission:');
  for (const item of items) {
    const current = await ctx.kv.getVersioned<Pending>(item.key);
    if (current && current.value.expires <= Date.now()) await ctx.kv.compareAndDelete(item.key, current.revision);
  }
}

export function publicHandler(handler: (ctx: RouteContext) => Promise<unknown>) {
  return async (ctx: RouteContext) => {
    try { return await handler(ctx); }
    catch (error) {
      if (error instanceof z.ZodError) return { ok: false, error: '入力内容を確認してください。' };
      return { ok: false, error: 'フォームを処理できませんでした。時間をおいて再度お試しください。' };
    }
  };
}
