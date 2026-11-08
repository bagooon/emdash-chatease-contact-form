import type { KVAccess, RouteContext } from 'emdash';
import { vi } from 'vitest';
import { formSchema, type GlobalSettings } from '../src/model.js';

export class MemoryStore implements KVAccess {
  private data = new Map<string, { value: unknown; revision: string }>();
  private revision = 0;
  async get<T>(key: string): Promise<T | null> { return structuredClone(this.data.get(key)?.value ?? null) as T | null; }
  async getVersioned<T>(key: string) { return structuredClone(this.data.get(key) ?? null) as { value: T; revision: string } | null; }
  async set(key: string, value: unknown) { this.data.set(key, { value: structuredClone(value), revision: String(++this.revision) }); }
  async delete(key: string) { return this.data.delete(key); }
  async list(prefix = '') { return [...this.data].filter(([key]) => key.startsWith(prefix)).map(([key, entry]) => ({ key, value: structuredClone(entry.value) })); }
  async compareAndSet(key: string, revision: string | null, value: unknown) {
    if ((this.data.get(key)?.revision ?? null) !== revision) return { applied: false } as const;
    const next = String(++this.revision);
    this.data.set(key, { value: structuredClone(value), revision: next });
    return { applied: true, revision: next } as const;
  }
  async compareAndDelete(key: string, revision: string) {
    if (this.data.get(key)?.revision !== revision) return { applied: false };
    return { applied: this.data.delete(key) };
  }
}

export const globals: GlobalSettings = {
  apiToken: 'test-api-token', workspaceSlug: 'test-workspace', deadlineDays: 1,
  notifyEmail: 'admin@example.test', timezone: 'Asia/Tokyo',
  turnstileSiteKey: '', turnstileSecretKey: '', recaptchaSiteKey: '', recaptchaSecretKey: '',
};
export const values = { company: 'テスト会社', name: '山田', email: 'guest@example.test', phone: '03-1234-5678', message: '問い合わせ本文' };

export async function context() {
  const settings = new MemoryStore();
  for (const [key, value] of Object.entries(globals)) await settings.set(key, value);
  await settings.set('formsData', JSON.stringify({
    contact: { config: formSchema.parse({ id: 'contact', name: 'お問い合わせ', usePhone: true }), secrets: { apiToken: '', guestPassphrase: '' } },
    other: { config: formSchema.parse({ id: 'other', name: '別フォーム' }), secrets: { apiToken: '', guestPassphrase: '' } },
  }));
  const ctx = {
    settings, kv: new MemoryStore(), input: {},
    site: { name: 'Test', url: 'https://site.example.test', locale: 'ja' },
    request: new Request('https://site.example.test/_emdash/api/plugins/chatease-contact-form/confirm', { headers: { origin: 'https://site.example.test' } }),
    email: { send: vi.fn().mockResolvedValue(undefined) },
    log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  } as unknown as RouteContext;
  return ctx;
}
