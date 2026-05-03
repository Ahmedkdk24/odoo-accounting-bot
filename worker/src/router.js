import { logInfo, logWarn } from './utils.js';
import { handleExtractPdf } from './handlers/extractPdf.js';

export default async function route(request, env, ctx, handlers) {
  const url = new URL(request.url);
  const path = url.pathname || '/';
  logInfo(`Routing request: ${path}`);

  switch (true) {
    case path === handlers.WEBHOOK_PATH:
      return handlers.handleWebhook(request, ctx);

    case path === '/extract-pdf':
      return await handleExtractPdf(request, env);

    case path === '/registerWebhook':
      return handlers.registerWebhook(request, env, url);

    case path === '/unRegisterWebhook':
      return handlers.unRegisterWebhook();

    default:
      logWarn('No handler for path', path);
      return new Response('OMC Telegram worker is running', { status: 200 });
  }
}
