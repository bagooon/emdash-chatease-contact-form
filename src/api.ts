import type { ResolvedForm, FormValues } from './model.js';
import { boardPayload } from './model.js';

async function request(path: string, apiToken: string, body: unknown) {
  const response = await fetch(`https://chatease.jp/api/v1${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Chatease-API-Token': apiToken },
    // Workers support manual redirects; response.ok below rejects 3xx without forwarding the token.
    body: JSON.stringify(body), signal: AbortSignal.timeout(20000), redirect: 'manual',
  });
  if (!response.ok) throw new Error('ChatEase API request failed');
  return response;
}

export async function workspaceName(apiToken: string, workspaceSlug: string): Promise<string> {
  const response = await request('/board/name', apiToken, { workspaceSlug });
  const data = await response.json() as { name?: unknown };
  if (typeof data.name !== 'string') throw new Error('Invalid workspace response');
  return data.name;
}

export async function createBoard(values: FormValues, form: ResolvedForm, key: string): Promise<void> {
  await request('/board', form.apiToken, { workspaceSlug: form.workspaceSlug, ...boardPayload(values, form, key) });
}
