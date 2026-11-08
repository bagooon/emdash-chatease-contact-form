import { resolve } from 'node:path';
import { build } from 'esbuild';
import { convertV4MiniflareOptions, Miniflare, Response as MockResponse } from 'miniflare';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

interface OutboundRequest { url: string; method: string; token: string | null; body: string }
const redirects = [301, 302, 303, 307, 308];
let worker: Miniflare;
let status = 200;
let outbound: OutboundRequest[] = [];

// Miniflare exposes Undici's fetch classes; adapt their types at the Node/Web boundary.
function mockResponse(body: string | null, init: ResponseInit = {}) {
  return new MockResponse(body, init as ConstructorParameters<typeof MockResponse>[1]);
}

beforeAll(async () => {
  // A packaged build can be tested without modifying or repacking its contents.
  const packageRoot = process.env.CHATEASE_WORKERS_PACKAGE_DIR;
  const output = await build({
    entryPoints: ['test/workers/fixture.ts'], nodePaths: [resolve('node_modules')], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    plugins: packageRoot ? [{ name: 'packaged-api', setup(builder) {
      builder.onResolve({ filter: /^\.\.\/\.\.\/src\/(api|admin)\.js$/ }, args => ({ path: resolve(packageRoot, 'dist', args.path.split('/').at(-1)!) }));
    } }] : [],
  });
  worker = new Miniflare({
    ...convertV4MiniflareOptions({
      host: '127.0.0.1', port: 0, modules: true, script: output.outputFiles[0].text, compatibilityDate: '2026-11-01', cf: false,
      // Every outbound request stays inside this mock, including a mistaken redirect follow.
      outboundService: async incoming => {
        const request = incoming as unknown as Pick<Request, 'url' | 'method' | 'headers' | 'text'>;
        outbound.push({ url: request.url, method: request.method, token: request.headers.get('X-Chatease-API-Token'), body: await request.text() });
        if (new URL(request.url).hostname !== 'chatease.jp') return mockResponse('Redirect destination must never be called', { status: 500 });
        if (status >= 300 && status < 400) return mockResponse(null, { status, headers: { Location: 'https://redirect-target.example.test/collect' } });
        return mockResponse(JSON.stringify({ name: 'Workers接続確認成功' }), { headers: { 'Content-Type': 'application/json' } });
      },
    }),
    telemetry: { enabled: false },
  });
  await worker.ready;
}, 30000);

afterAll(async () => { await worker?.dispose(); });
beforeEach(() => { status = 200; outbound = []; });

async function run(path: string) {
  const response = await worker.dispatchFetch('https://worker.example.test' + path) as unknown as Response;
  expect(response.status).toBe(200);
  return response.json() as Promise<Record<string, unknown>>;
}

describe('実際のworkerdランタイム', () => {
  it('旧redirect:errorが未対応モードの例外になることを再現する', async () => {
    const result = await run('/unsupported-mode');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Invalid redirect value/);
    expect(outbound).toHaveLength(0);
  });

  it('修正後はWorkersのfetchで接続確認に成功する', async () => {
    expect(await run('/workspace')).toEqual({ ok: true, name: 'Workers接続確認成功' });
    expect(outbound).toEqual([{ url: 'https://chatease.jp/api/v1/board/name', method: 'POST', token: 'workers-old-test-token', body: JSON.stringify({ workspaceSlug: 'workers-old-workspace' }) }]);
  });

  it('共通設定の保存と接続先名の更新に成功し、メールを送らない', async () => {
    expect(await run('/save')).toEqual({ ok: true, settingsUnchanged: false, workspaceSlug: 'workers-new-workspace', workspaceName: 'Workers接続確認成功', tokenUpdated: true, emails: 0 });
    expect(outbound).toHaveLength(1);
    expect(outbound[0].token).toBe('workers-new-test-token');
  });

  it('ボード作成もWorkersのfetchで成功し、payloadを維持する', async () => {
    expect(await run('/board')).toEqual({ ok: true });
    expect(outbound).toHaveLength(1);
    expect(outbound[0]).toMatchObject({ url: 'https://chatease.jp/api/v1/board', method: 'POST', token: 'workers-old-test-token' });
    expect(JSON.parse(outbound[0].body)).toMatchObject({ boardUniqueKey: 'workers-runtime-board-key', initialGuestComment: { content: 'モック問い合わせ' } });
  });

  for (const operation of ['/workspace', '/board', '/save']) {
    it.each(redirects)(operation + 'の%iで転送せず、既存設定を保持する', async responseStatus => {
      status = responseStatus;
      const result = await run(operation);
      expect(result.ok).toBe(false);
      if (operation === '/save') expect(result).toMatchObject({ settingsUnchanged: true, workspaceSlug: 'workers-old-workspace', workspaceName: '変更前の名前', tokenUpdated: false, emails: 0 });
      expect(outbound).toHaveLength(1);
      expect(new URL(outbound[0].url).hostname).toBe('chatease.jp');
      expect(outbound[0].token).toBe(operation === '/save' ? 'workers-new-test-token' : 'workers-old-test-token');
    });
  }
});
