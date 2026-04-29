import route from './router.js';
import { setTelegramToken, apiUrl } from './services/telegram.js';
import { logInfo, logError } from './utils.js';
import handleInvoice from './handlers/invoice.js';

const WEBHOOK = '/endpoint';

export default {
  async fetch(request, env, ctx) {
    const token = env.TELEGRAM_TOKEN;
    const secret = env.TELEGRAM_SECRET;

    if (!token || !secret) {
      logError('Missing required environment bindings: TELEGRAM_TOKEN, TELEGRAM_SECRET');
      return new Response('Missing environment configuration', { status: 500 });
    }

    setTelegramToken(token);

    const handlers = {
      WEBHOOK_PATH: WEBHOOK,
      handleWebhook: (request, ctx) => handleInvoice(request, env, ctx),
      registerWebhook: (request, env, url) => registerWebhook(request, env, url),
      unRegisterWebhook: () => unRegisterWebhook()
    };

    return route(request, env, ctx, handlers);
  }
};

async function registerWebhook(request, env, url) {
  const webhookUrl = `${url.protocol}//${url.hostname}${WEBHOOK}`;
  logInfo(`Registering webhook at ${webhookUrl}`);

  const response = await fetch(apiUrl('setWebhook', {
    url: webhookUrl,
    secret_token: env.TELEGRAM_SECRET
  }));

  const json = await response.json();
  return new Response(JSON.stringify(json, null, 2), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function unRegisterWebhook() {
  logInfo('Deleting webhook');
  const response = await fetch(apiUrl('deleteWebhook'));
  const json = await response.json();
  return new Response(JSON.stringify(json, null, 2), {
    headers: { 'Content-Type': 'application/json' }
  });
}
