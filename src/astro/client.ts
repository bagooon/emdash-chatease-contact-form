import { API_PATH } from '../model.js';
import type { FormValues, publicForm } from '../model.js';

type PublicForm = ReturnType<typeof publicForm>;
interface Result { ok: boolean; error?: string; form?: PublicForm; token?: string; values?: FormValues; expired?: boolean }
interface CaptchaApi {
  render(container: HTMLElement, options: { sitekey: string }): string | number;
  getResponse(id: string | number): string;
  reset(id: string | number): void;
  remove?(id: string | number): void;
}
const captchaScripts = new Map<string, Promise<CaptchaApi>>();

function loadCaptcha(provider: 'turnstile' | 'recaptcha'): Promise<CaptchaApi> {
  const existing = (window as unknown as Record<string, CaptchaApi | undefined>)[provider === 'turnstile' ? 'turnstile' : 'grecaptcha'];
  if (existing?.render) return Promise.resolve(existing);
  const previous = captchaScripts.get(provider);
  if (previous) return previous;
  const task = new Promise<CaptchaApi>((resolve, reject) => {
    const callback = provider === 'turnstile' ? '__chateaseTurnstileReady' : '__chateaseRecaptchaReady';
    const globals = window as unknown as Record<string, unknown>;
    const script = document.createElement('script');
    const timer = window.setTimeout(() => failed(), 20000);
    function failed() {
      window.clearTimeout(timer);
      captchaScripts.delete(provider);
      delete globals[callback];
      script.remove();
      reject(new Error('スパム対策を読み込めませんでした。時間をおいて再度お試しください。'));
    }
    globals[callback] = () => {
      window.clearTimeout(timer);
      delete globals[callback];
      const api = globals[provider === 'turnstile' ? 'turnstile' : 'grecaptcha'] as CaptchaApi | undefined;
      if (api) resolve(api); else failed();
    };
    script.src = provider === 'turnstile'
      ? `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=${callback}`
      : `https://www.google.com/recaptcha/api.js?render=explicit&onload=${callback}`;
    script.async = true;
    script.onerror = failed;
    document.head.append(script);
  });
  captchaScripts.set(provider, task);
  return task;
}

const styles = `
.chatease-styled { display:block; max-width:48rem; margin:1.5rem auto; font:inherit; }
.chatease-styled .chatease-intro { margin:0 0 1.25rem; padding:1rem 1.25rem; border:1px solid #dcdfe3; background:#f7f9fc; color:#1f2937; border-radius:6px; }
.chatease-styled .chatease-intro p { margin:0; line-height:1.8; }
.chatease-styled label { display:block; font-weight:600; margin-bottom:.35rem; }
.chatease-styled .chatease-field { margin-bottom:1.2rem; }
.chatease-styled input,.chatease-styled textarea { box-sizing:border-box; width:100%; font:inherit; color:inherit; background:transparent; border:1px solid #999; border-radius:.35rem; padding:.7rem; }
.chatease-styled textarea { min-height:10rem; }
.chatease-styled button { font:inherit; cursor:pointer; padding:.65rem 1.3rem; margin:.6rem .5rem .2rem 0; border:1px solid #1868a7; border-radius:.35rem; background:#1868a7; color:#fff; }
.chatease-styled button:disabled { opacity:.6; cursor:wait; }
.chatease-styled [role=alert] { color:#b42318; white-space:pre-wrap; }
.chatease-styled dt { font-weight:600; margin-top:1rem; }
.chatease-styled dd { margin:.35rem 0; white-space:pre-wrap; overflow-wrap:anywhere; }
chatease-contact-form [hidden] { display:none !important; }
`;

export class ChatEaseContactForm extends HTMLElement {
  private initialized = false;
  private config?: PublicForm;
  private inputForm?: HTMLFormElement;
  private inputPanel?: HTMLElement;
  private confirmPanel?: HTMLElement;
  private errorBox?: HTMLElement;
  private statusBox?: HTMLElement;
  private token?: string;
  private captcha?: CaptchaApi;
  private widgetId?: string | number;
  private busy = false;

  connectedCallback() {
    if (this.initialized) return;
    this.initialized = true;
    void this.initialize();
  }

  private async request(route: string, data?: unknown): Promise<Result> {
    const url = `${API_PATH}/${route}`;
    try {
      const response = await fetch(url, data === undefined ? { credentials: 'same-origin', cache: 'no-store' } : {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-EmDash-Request': '1' }, body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error('HTTP request failed');
      const envelope = await response.json();
      // EmDash wraps plugin JSON in its shared success/data envelope.
      return (envelope.data ?? envelope) as Result;
    } catch {
      throw new Error('通信に失敗しました。時間をおいて再度お試しください。');
    }
  }

  private async initialize() {
    try {
      const result = await this.request(`form?formId=${encodeURIComponent(this.dataset.formId ?? 'contact')}`);
      if (!this.isConnected) { this.initialized = false; return; }
      if (!result.ok || !result.form) throw new Error(result.error || 'フォームを読み込めませんでした。');
      this.config = result.form;
      this.render();
      if (result.form.captcha.provider !== 'none') {
        this.setBusy(true);
        try {
          this.captcha = await loadCaptcha(result.form.captcha.provider);
          if (this.isConnected) this.widgetId = this.captcha.render(this.querySelector<HTMLElement>('[data-captcha]')!, { sitekey: result.form.captcha.siteKey });
        } finally { this.setBusy(false); }
      }
    } catch (error) {
      if (this.errorBox) this.showError(error);
      else {
        this.replaceChildren();
        const message = document.createElement('p');
        message.setAttribute('role', 'alert');
        message.textContent = error instanceof Error ? error.message : 'フォームを読み込めませんでした。';
        this.append(message);
      }
      const retry = this.button('再読み込み', () => { this.replaceChildren(); this.errorBox = undefined; void this.initialize(); });
      this.append(retry);
    }
  }

  private button(label: string, action?: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    if (action) button.addEventListener('click', action);
    return button;
  }

  private render() {
    const config = this.config!;
    this.replaceChildren();
    this.classList.toggle('chatease-styled', config.usePluginStyle);
    // Styling is added only for forms that opt in. No global theme selectors.
    if (config.usePluginStyle) {
      const style = document.createElement('style');
      style.textContent = styles;
      this.append(style);
    }
    this.errorBox = document.createElement('p');
    this.errorBox.setAttribute('role', 'alert');
    this.errorBox.tabIndex = -1;
    this.statusBox = document.createElement('p');
    this.statusBox.setAttribute('role', 'status');
    this.inputPanel = document.createElement('div');
    this.inputForm = document.createElement('form');
    const instance = crypto.randomUUID();
    for (const name of ['company', 'name', 'email', 'phone', 'message'] as const) {
      if (name === 'phone' && !config.usePhone) continue;
      const field = document.createElement('div');
      field.className = 'chatease-field';
      const label = document.createElement('label');
      label.htmlFor = `${instance}-${name}`;
      const required = ['name', 'email', 'message'].includes(name) || (name === 'phone' && config.requirePhone);
      label.textContent = config.labels[name] + (required ? '（必須）' : '');
      const input = name === 'message' ? document.createElement('textarea') : document.createElement('input');
      input.id = label.htmlFor;
      input.name = name;
      input.required = required;
      input.maxLength = name === 'message' ? 20000 : name === 'email' ? 254 : name === 'phone' ? 100 : 200;
      if (input instanceof HTMLInputElement) {
        input.type = name === 'email' ? 'email' : name === 'phone' ? 'tel' : 'text';
        input.autocomplete = name === 'company' ? 'organization' : name === 'phone' ? 'tel' : name === 'email' ? 'email' : 'name';
      }
      field.append(label, input);
      this.inputForm.append(field);
    }
    const captcha = document.createElement('div');
    captcha.dataset.captcha = '';
    const confirmButton = this.button('入力内容を確認');
    confirmButton.type = 'submit';
    this.inputForm.append(captcha, confirmButton);
    this.inputForm.addEventListener('submit', event => { event.preventDefault(); void this.confirm(); });
    const intro = document.createElement('div');
    intro.className = 'chatease-intro';
    const explanation = document.createElement('p');
    explanation.textContent = '個別にチャットにてご返答させていただきます。準備が整いましたらチャットボードへのアクセス方法をメールにてお知らせいたします。';
    const workspaceName = config.workspaceName?.trim();
    if (workspaceName) {
      explanation.append(document.createElement('br'), `メールの件名は 『 【 ${workspaceName} 】チャットボード更新のお知らせ 』です。`);
    }
    intro.append(explanation);
    this.inputPanel.append(intro, this.inputForm);
    this.confirmPanel = document.createElement('div');
    this.confirmPanel.hidden = true;
    this.confirmPanel.tabIndex = -1;
    this.append(this.errorBox, this.statusBox, this.inputPanel, this.confirmPanel);
  }

  private setBusy(value: boolean) {
    this.busy = value;
    this.setAttribute('aria-busy', String(value));
    this.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = value; });
    if (this.statusBox) this.statusBox.textContent = value ? '処理中です。' : '';
  }

  private showError(error: unknown) {
    if (!this.errorBox) return;
    this.errorBox.textContent = error instanceof Error ? error.message : String(error);
    this.errorBox.focus();
  }

  private resetCaptcha() {
    if (this.captcha && this.widgetId !== undefined) this.captcha.reset(this.widgetId);
  }

  private async confirm() {
    if (this.busy || !this.inputForm?.reportValidity()) return;
    const values = Object.fromEntries(new FormData(this.inputForm).entries());
    this.setBusy(true);
    this.errorBox!.textContent = '';
    try {
      const result = await this.request('confirm', { formId: this.config!.id, values, captchaToken: this.widgetId !== undefined ? this.captcha?.getResponse(this.widgetId) : '' });
      if (!result.ok || !result.token || !result.values) throw new Error(result.error || '入力内容を確認してください。');
      this.token = result.token;
      const description = document.createElement('p');
      description.textContent = '以下の内容で送信します。';
      const list = document.createElement('dl');
      for (const key of ['company', 'name', 'email', 'phone', 'message'] as const) {
        if (key === 'phone' && !this.config!.usePhone) continue;
        const term = document.createElement('dt');
        term.textContent = this.config!.labels[key];
        const definition = document.createElement('dd');
        definition.textContent = result.values[key] || '（未入力）';
        list.append(term, definition);
      }
      this.confirmPanel!.replaceChildren(description, list, this.button('戻る', () => this.back()), this.button('送信する', () => { void this.submit(); }));
      this.inputPanel!.hidden = true;
      this.confirmPanel!.hidden = false;
      this.confirmPanel!.focus();
    } catch (error) { this.showError(error); this.resetCaptcha(); }
    finally { this.setBusy(false); }
  }

  private back() {
    if (this.busy) return;
    this.token = undefined;
    this.confirmPanel!.hidden = true;
    this.inputPanel!.hidden = false;
    this.resetCaptcha();
    this.inputForm!.querySelector('input')?.focus();
  }

  private async submit() {
    if (this.busy || !this.token) return;
    let completed = false;
    this.setBusy(true);
    this.errorBox!.textContent = '';
    try {
      const result = await this.request('submit', { formId: this.config!.id, token: this.token });
      if (!result.ok) {
        if (result.expired) { this.setBusy(false); this.back(); }
        throw new Error(result.error || '送信に失敗しました。');
      }
      completed = true;
      this.token = undefined;
      this.inputForm!.reset();
      this.confirmPanel!.hidden = true;
      this.statusBox!.textContent = 'お問い合わせを送信しました。担当者からの返信をお待ちください。';
      this.statusBox!.tabIndex = -1;
      this.statusBox!.focus();
    } catch (error) { this.showError(error); }
    finally {
      if (!completed) this.statusBox!.textContent = '';
      this.busy = false;
      this.setAttribute('aria-busy', 'false');
      this.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = false; });
    }
  }
}

if (!customElements.get('chatease-contact-form')) customElements.define('chatease-contact-form', ChatEaseContactForm);
