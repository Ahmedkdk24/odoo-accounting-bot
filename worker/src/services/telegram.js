import { logInfo, logError } from '../utils.js';

let TOKEN;

export function setTelegramToken(token) {
  TOKEN = token;
}

export function apiUrl(method, params = {}) {
  return `https://api.telegram.org/bot${TOKEN}/${method}?${new URLSearchParams(params)}`;
}

export async function downloadTelegramFile(fileId) {
  logInfo(`Downloading Telegram file ${fileId}`);

  const metaResponse = await fetch(apiUrl('getFile', { file_id: fileId }));
  const meta = await metaResponse.json();
  if (!meta.ok) {
    throw new Error(`Telegram getFile failed: ${JSON.stringify(meta)}`);
  }

  const filePath = meta.result.file_path;
  const fileResponse = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${filePath}`);
  if (!fileResponse.ok) {
    throw new Error(`Telegram file download failed with status ${fileResponse.status}`);
  }

  const arrayBuffer = await fileResponse.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  logInfo('Downloaded Telegram file successfully');
  return bytes;
}

export async function sendPlainText(chatId, text) {
  logInfo(`Sending text to ${chatId}: ${text.substring(0, 80)}`);
  try {
    const response = await fetch(apiUrl('sendMessage', {
      chat_id: chatId,
      text
    }));
    const result = await response.json();
    if (!result.ok) {
      logError('Telegram sendMessage failed', JSON.stringify(result));
    }
    return result;
  } catch (error) {
    logError('Telegram sendMessage error', error);
    throw error;
  }
}
