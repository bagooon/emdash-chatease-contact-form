import type { RouteContext } from 'emdash';
import { admin } from '../../src/admin.js';
import { createBoard, workspaceName } from '../../src/api.js';
import { formSchema, resolveForm, type GlobalSettings } from '../../src/model.js';

const globals: GlobalSettings = {
  apiToken: 'workers-old-test-token', workspaceSlug: 'workers-old-workspace', deadlineDays: 1,
  notifyEmail: 'admin@example.test', timezone: 'Asia/Tokyo', turnstileSiteKey: '', turnstileSecretKey: '', recaptchaSiteKey: '', recaptchaSecretKey: '',
};

export default {
  async fetch(request: Request): Promise<Response> {
    const operation = new URL(request.url).pathname;
    try {
      if (operation === '/unsupported-mode') {
        await fetch('https://chatease.jp/api/v1/board/name', { redirect: 'error' });
        return Response.json({ ok: true });
      }
      if (operation === '/workspace') {
        return Response.json({ ok: true, name: await workspaceName(globals.apiToken, globals.workspaceSlug) });
      }
      if (operation === '/board') {
        const form = resolveForm(formSchema.parse({ id: 'contact', name: 'お問い合わせ', usePhone: true }), { apiToken: '', guestPassphrase: '' }, globals);
        await createBoard({ company: '検証会社', name: '検証', email: 'guest@example.test', phone: '000-0000-0000', message: 'モック問い合わせ' }, form, 'workers-runtime-board-key');
        return Response.json({ ok: true });
      }
      if (operation === '/save') {
        const settings = new Map<string, unknown>(Object.entries({ ...globals, workspaceName: '変更前の名前' }));
        const before = JSON.stringify([...settings]);
        let revision = 0;
        let emails = 0;
        const ctx = {
          input: { type: 'form_submit', action_id: 'save-general', values: { ...globals, apiToken: 'workers-new-test-token', workspaceSlug: 'workers-new-workspace' } },
          settings: {
            get: async (key: string) => settings.get(key) ?? null,
            getVersioned: async (key: string) => settings.has(key) ? { value: settings.get(key), revision: String(revision) } : null,
            set: async (key: string, value: unknown) => { settings.set(key, value); revision++; },
          },
          email: { send: async () => { emails++; } },
        } as unknown as RouteContext;
        const result = await admin(ctx);
        return Response.json({
          ok: result.toast?.type === 'success', settingsUnchanged: before === JSON.stringify([...settings]),
          workspaceSlug: settings.get('workspaceSlug'), workspaceName: settings.get('workspaceName'),
          tokenUpdated: settings.get('apiToken') === 'workers-new-test-token', emails,
        });
      }
      return Response.json({ ok: false, error: 'Unknown operation' }, { status: 404 });
    } catch (error) {
      return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error), errorName: error instanceof Error ? error.name : 'unknown' });
    }
  },
};
