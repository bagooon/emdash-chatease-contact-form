import { definePlugin, type PluginDescriptor, type PortableTextBlockConfig } from 'emdash';
import { admin } from './admin.js';
import { PACKAGE_NAME, PLUGIN_ID, VERSION } from './model.js';
import { cleanup, confirm, getPublicForm, publicHandler, submit } from './service.js';
import { settingsSchema } from './store.js';

const pages = [
  { path: '/general', label: 'ChatEase 共通設定', icon: 'settings' },
  { path: '/forms', label: 'ChatEase フォーム一覧', icon: 'mail' },
];
const blocks: PortableTextBlockConfig[] = [{
  type: 'chateaseContactForm', label: 'ChatEase お問い合わせフォーム', icon: 'mail', category: 'Embeds',
  description: 'ChatEaseのチャットボードに連携するお問い合わせフォーム',
  fields: [{ type: 'text_input', action_id: 'formId', label: 'フォームID', initial_value: 'contact' }],
}];

export function chateasePlugin(): PluginDescriptor {
  return {
    id: PLUGIN_ID, version: VERSION, format: 'native', entrypoint: PACKAGE_NAME,
    componentsEntry: `${PACKAGE_NAME}/astro`, adminPages: pages,
    portableTextBlocks: blocks, settingsSchema,
  };
}

export function createPlugin() {
  return definePlugin({
    id: PLUGIN_ID, version: VERSION,
    capabilities: ['email:send', 'network:request'],
    allowedHosts: ['chatease.jp', 'challenges.cloudflare.com', 'www.google.com'],
    admin: { pages, portableTextBlocks: blocks, settingsSchema },
    hooks: {
      'plugin:activate': async (_event, ctx) => {
        await ctx.cron?.schedule('cleanup-confirmations', { schedule: '*/15 * * * *' });
      },
      cron: async (event, ctx) => { if (event.name === 'cleanup-confirmations') await cleanup(ctx); },
    },
    routes: {
      admin: { methods: ['POST'], permission: 'plugins:manage', request: { body: 'json', maxBytes: 65536 }, handler: admin },
      form: { methods: ['GET'], public: true, handler: publicHandler(getPublicForm) },
      confirm: { methods: ['POST'], public: true, request: { body: 'json', maxBytes: 131072 }, handler: publicHandler(confirm) },
      submit: { methods: ['POST'], public: true, request: { body: 'json', maxBytes: 2048 }, handler: publicHandler(submit) },
    },
  });
}
export default chateasePlugin;
