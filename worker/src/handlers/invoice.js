// Robust date normalization for LLM output
function normalizeDate(value) {
  if (!value || typeof value !== 'string') return null;
  let str = value.trim();
  // Try ISO first
  let date = new Date(str);
  if (!isNaN(date)) {
    return date.toISOString().slice(0, 10);
  }
  // Try to handle common natural language formats
  // Remove commas, handle Arabic/English months
  str = str.replace(/،/g, ',').replace(/,/g, '').replace(/\s+/g, ' ');
  // English months
  const months = {
    'january': 0, 'jan': 0,
    'february': 1, 'feb': 1,
    'march': 2, 'mar': 2,
    'april': 3, 'apr': 3,
    'may': 4,
    'june': 5, 'jun': 5,
    'july': 6, 'jul': 6,
    'august': 7, 'aug': 7,
    'september': 8, 'sep': 8, 'sept': 8,
    'october': 9, 'oct': 9,
    'november': 10, 'nov': 10,
    'december': 11, 'dec': 11
  };
  // Arabic months (basic)
  const arMonths = {
    'يناير': 0, 'فبراير': 1, 'مارس': 2, 'أبريل': 3, 'ابريل': 3, 'مايو': 4, 'يونيو': 5, 'يوليو': 6, 'أغسطس': 7, 'اغسطس': 7, 'سبتمبر': 8, 'أكتوبر': 9, 'اكتوبر': 9, 'نوفمبر': 10, 'ديسمبر': 11
  };
  // Try DD Month YYYY
  let match = str.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (match) {
    const day = parseInt(match[1], 10);
    const month = months[match[2].toLowerCase()];
    const year = parseInt(match[3], 10);
    if (month !== undefined) {
      date = new Date(year, month, day);
      if (!isNaN(date)) return date.toISOString().slice(0, 10);
    }
  }
  // Try DD Month, YYYY
  match = str.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (match) {
    const day = parseInt(match[1], 10);
    const month = months[match[2].toLowerCase()];
    const year = parseInt(match[3], 10);
    if (month !== undefined) {
      date = new Date(year, month, day);
      if (!isNaN(date)) return date.toISOString().slice(0, 10);
    }
  }
  // Try DD Month YYYY (Arabic)
  match = str.match(/(\d{1,2})\s+([\u0600-\u06FF]+)\s+(\d{4})/);
  if (match) {
    const day = parseInt(match[1], 10);
    const month = arMonths[match[2]];
    const year = parseInt(match[3], 10);
    if (month !== undefined) {
      date = new Date(year, month, day);
      if (!isNaN(date)) return date.toISOString().slice(0, 10);
    }
  }
  // Try YYYY-MM-DD
  match = str.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    date = new Date(match[0]);
    if (!isNaN(date)) return date.toISOString().slice(0, 10);
  }
  // Try fallback: parse numbers
  match = str.match(/(\d{1,2})[\s/-]+([A-Za-z\u0600-\u06FF]+)[\s/-]+(\d{4})/);
  if (match) {
    const day = parseInt(match[1], 10);
    const m = match[2];
    const year = parseInt(match[3], 10);
    let month = months[m.toLowerCase()];
    if (month === undefined) month = arMonths[m];
    if (month !== undefined) {
      date = new Date(year, month, day);
      if (!isNaN(date)) return date.toISOString().slice(0, 10);
    }
  }
  logError('Invalid date format from LLM', value);
  return null;
}
import { logInfo, logError } from '../utils.js';
import { downloadTelegramFile, sendPlainText } from '../services/telegram.js';
import { convertPdfToImage } from './cloudconvert.js';
import Groq from 'groq-sdk';
const SECRET_HEADER = 'X-Telegram-Bot-Api-Secret-Token';

const LLM_INVOICE_ONE_SHOT_PROMPT = `
Extract structured accounting data directly from the image.

CRITICAL RULES:
- Output ONLY valid JSON
- Do NOT describe the image
- Do NOT explain anything
- Do NOT include markdown
- If you cannot extract, return empty fields but STILL return JSON

FORMAT:

{
  "partner_name": "",
  "date": "",
  "reference": "",
  "vat_no": "",
  "amount": 0,
  "lines": [
    {
      "name": "",
      "quantity": 0,
      "unit_price": 0,
      "total": 0
    }
  ]
}

Arabic hints:
- الكمية = quantity
- السعر = unit_price
- الإجمالي = total
`;



export default async function handleInvoice(request, env, ctx) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  if (request.headers.get(SECRET_HEADER) !== env.TELEGRAM_SECRET) {
    logError('Unauthorized webhook request');
    return new Response('Unauthorized', { status: 403 });
  }


  let update;
  try {
    update = await request.json();
  } catch (error) {
    logError('Invalid JSON payload', error);
    return new Response('Bad request', { status: 400 });
  }

  const message = update.message;
  if (!message) {
    logInfo('Webhook update has no message');
    return new Response('Ok');
  }

  // --- Cloudflare KV user check ---
  const userId = message.from?.id?.toString();
  if (!userId) {
    await sendPlainText(message.chat.id, '⛔ Access denied: No user ID');
    return new Response('Ok');
  }

  // Check if ALLOWED_USERS KV binding exists
  if (!env.ALLOWED_USERS) {
    logError('ALLOWED_USERS KV binding is not configured');
    await sendPlainText(message.chat.id, '⛔ Access system unavailable');
    return new Response('Ok');
  }

  // Check if user is registered in KV namespace
  const isAllowed = await env.ALLOWED_USERS.get(userId);
  if (!isAllowed) {
    logInfo(`Access denied for user ${userId}`);
    await sendPlainText(message.chat.id, '⛔ Access denied');
    return new Response('Ok');
  }

  const chatId = message.chat.id;
  if (message.text) {
    const text = message.text.trim();
    if (text.startsWith('/start') || text.startsWith('/help')) {
      await sendPlainText(chatId, 'Send an invoice PDF or image in English or Arabic to create an Odoo bill.');
      return new Response('Ok');
    }
    await sendPlainText(chatId, 'Please send a PDF or image invoice in English or Arabic. Text messages are not processed.');
    return new Response('Ok');
  }

  const filePayload = getTelegramFilePayload(message);
  if (!filePayload) {
    await sendPlainText(chatId, 'Send an invoice PDF or an invoice image to process.');
    return new Response('Ok');
  }

  let r2Key = null;
  const keepR2Objects = env.KEEP_R2_OBJECTS === 'true';

  try {
    const fileData = await downloadTelegramFile(filePayload.fileId);
    logInfo('Invoice file downloaded', filePayload.fileName, filePayload.mimeType, fileData.byteLength);

    if (!env.INVOICE_BUCKET) {
      throw new Error('Missing INVOICE_BUCKET binding');
    }
    if (!env.R2_PUBLIC_BASE_URL) {
      throw new Error('Missing R2_PUBLIC_BASE_URL');
    }

    r2Key = await uploadInvoiceToR2(fileData, filePayload.fileName, filePayload.mimeType, env);
    const imageUrl = getR2PublicUrl(r2Key, env);
    logInfo('Constructed imageUrl', imageUrl);

    const extractedData = await processInvoice(request, fileData, filePayload.mimeType, imageUrl, env);

    if (!isValidExtractedInvoiceData(extractedData)) {
      logInfo('Invoice validation failed', JSON.stringify(extractedData));
      await sendPlainText(chatId, '⚠️ Could not confidently extract invoice data. Please review.');
      return new Response('Ok');
    }

    const billId = await createOdooBill(extractedData, env);
    await sendPlainText(chatId, `Invoice processed successfully. Created Bill ID: ${billId}.`);
  } catch (error) {
    logError('Processing failed', error);
    const message = String(error?.message || error);
    if (/Groq API key rejected|Missing GROQ_API_KEY|401|PERMISSION_DENIED|Unauthorized/i.test(message)) {
      await sendPlainText(chatId, 'Invoice processing failed because Groq rejected the API key. Create a new Groq API key and update the Worker secret.');
    } else if (/Groq API unavailable|503|Service Unavailable|UNAVAILABLE|timeout/i.test(message)) {
      await sendPlainText(chatId, 'Invoice processing failed because Groq API is temporarily unavailable. Please try again later.');
    } else if (/Groq API error/i.test(message)) {
      await sendPlainText(chatId, `Invoice processing failed due to Groq API issue: ${message.replace('Groq API error: ', '')}`);
    } else {
      await sendPlainText(chatId, 'Invoice processing failed. Please try again.');
    }
  } finally {
    if (r2Key && !keepR2Objects) {
      try {
        await deleteR2Object(r2Key, env);
        logInfo('Cleaned up R2 object', r2Key);
      } catch (cleanupError) {
        logError('R2 cleanup failed', cleanupError);
      }
    }
  }

  return new Response('Ok');
}

function getTelegramFilePayload(message) {
  if (message.document?.mime_type === 'application/pdf') {
    return {
      fileId: message.document.file_id,
      fileName: message.document.file_name || 'invoice.pdf',
      mimeType: 'application/pdf'
    };
  }

  if (message.document?.mime_type?.startsWith('image/')) {
    return {
      fileId: message.document.file_id,
      fileName: message.document.file_name || 'invoice.jpg',
      mimeType: message.document.mime_type
    };
  }

  if (Array.isArray(message.photo) && message.photo.length) {
    const photo = message.photo[message.photo.length - 1];
    return {
      fileId: photo.file_id,
      fileName: 'invoice.jpg',
      mimeType: 'image/jpeg'
    };
  }

  return null;
}

async function processInvoice(request, fileData, mimeType, imageUrl, env) {
  if (!env.GROQ_API_KEY) {
    throw new Error('Missing GROQ_API_KEY secret');
  }

  const groq = new Groq({ apiKey: env.GROQ_API_KEY });
  let extractedData = null;

  // IMAGE PIPELINE (existing, untouched)
  if (mimeType.startsWith('image/')) {
    logInfo('Processing image invoice');
    if (!imageUrl) {
      throw new Error('Missing image URL for image invoice');
    }
    extractedData = await extractDataFromImage(imageUrl, groq);
  }
  // PDF PIPELINE (CloudConvert PDF to image, then single Groq call)
  else if (mimeType === 'application/pdf') {
    logInfo('Processing PDF invoice via CloudConvert', imageUrl);
    try {
      const apiKey = env.CLOUDCONVERT_API_KEY;
      if (!apiKey) throw new Error('Missing CloudConvert API key');
      const imageUrlFromPdf = await convertPdfToImage(imageUrl, apiKey);
      logInfo('CloudConvert PDF->image result', imageUrlFromPdf);

      const messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: LLM_INVOICE_ONE_SHOT_PROMPT },
            { type: 'image_url', image_url: { url: imageUrlFromPdf } }
          ]
        }
      ];

      extractedData = await callGroqExtraction(groq, messages);

    } catch (pdfError) {
      logError('CloudConvert PDF->image failed', pdfError);
      throw new Error(`PDF to image conversion failed: ${pdfError.message}`);
    }
  }
  // UNSUPPORTED TYPE
  else {
    throw new Error(`Unsupported file type: ${mimeType}`);
  }

  if (!extractedData || typeof extractedData !== 'object') {
    throw new Error('LLM returned invalid invoice data');
  }

  logInfo('Parsed JSON from LLM', JSON.stringify(extractedData));
  return normalizeInvoiceData(extractedData);
}

async function extractDataFromImage(imageUrl, groq) {
  logInfo('Sending image URL to LLM for invoice extraction');
  logInfo('LLM image request', imageUrl);
  const messages = [
    {
      role: 'system',
      content: `
  You are a strict JSON API.

  You NEVER describe images.
  You NEVER explain.
  You ONLY return valid JSON.

  If output is not JSON, the system will fail.
  `
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: LLM_INVOICE_ONE_SHOT_PROMPT },
        { type: 'image_url', image_url: { url: imageUrl } }
      ]
    }
  ];

  return await callGroqExtraction(groq, messages);
}

async function extractDataFromText(text, groq) {
  logInfo('Sending PDF text to LLM for invoice extraction');
  const messages = [
    {
      role: 'user',
      content: [
          {
            type: 'text',
            text: ''
          },
        {
          type: 'text',
          text: `Invoice text:\n${text}`
        }
      ]
    }
  ];

  return await callGroqExtraction(groq, messages);
}

async function callGroqExtraction(groq, messages, maxRetries = 1) {
  const requestBody = {
    messages,
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    temperature: 0,
    max_completion_tokens: 2048,
    top_p: 1,
    stream: false,
    stop: null
  };

  let attempt = 0;
  while (true) {
    try {
      logInfo(`LLM request sent (attempt ${attempt + 1})`);
      const chatCompletion = await groq.chat.completions.create(requestBody);
      let responseText = chatCompletion.choices?.[0]?.message?.content;
      
      if (typeof responseText === 'string') {
        const trimmed = responseText.trim();
        const encoded = new TextEncoder().encode(trimmed);
        responseText = new TextDecoder('utf-8').decode(encoded);
      }
      
      responseText = responseText?.trim();
      logInfo('Raw LLM response received');
      logInfo(`Raw LLM response: ${responseText?.substring(0, 500)}`);

      if (!responseText) {
        throw new Error('Empty response from Groq API');
      }

      const sanitized = sanitizeJsonResponse(responseText);
      logInfo('Sanitized LLM response', sanitized.substring(0, 500));

      const parsed = parseJsonFromString(sanitized) || tryParseJsonCandidate(sanitized);
      if (parsed) {
        logInfo('Successfully parsed LLM response to JSON', JSON.stringify(parsed));
        return parsed;
      }

      // 👇 ADD THIS BLOCK HERE
      if (!parsed) {
        logInfo('Initial JSON parse failed. Attempting repair step...');

        const repairMessages = [
          {
            role: 'system',
            content: 'Convert the following text into valid JSON only. No explanation.'
          },
          {
            role: 'user',
            content: sanitized
          }
        ];

        try {
          const repairResponse = await groq.chat.completions.create({
            messages: repairMessages,
            model: 'meta-llama/llama-4-scout-17b-16e-instruct',
            temperature: 0
          });

          const repairText = repairResponse.choices?.[0]?.message?.content?.trim();

          const repairedParsed =
            parseJsonFromString(repairText) ||
            tryParseJsonCandidate(repairText);

          if (repairedParsed) {
            logInfo('Repair step succeeded', JSON.stringify(repairedParsed));
            return repairedParsed;
          }

        } catch (repairError) {
          logError('Repair step failed', repairError);
        }
      }

      // 👇 ONLY FAIL AFTER BOTH ATTEMPTS
      throw new Error(`JSON parse failed even after repair. Text: ${sanitized.substring(0, 200)}`);

      throw new Error(`LLM did not return JSON or JSON parse failed. Text: ${sanitized.substring(0, 200)}`);
    } catch (error) {
      const message = error?.message || String(error);
      logError('Groq extraction failed', error);

      if (attempt >= maxRetries) {
        if (/401|PERMISSION_DENIED|Unauthorized|API key/i.test(message)) {
          throw new Error(`Groq API key rejected: ${message}`);
        }
        if (/503|Service Unavailable|UNAVAILABLE|timeout/i.test(message)) {
          throw new Error(`Groq API unavailable: ${message}`);
        }
        if (/JSON parse|parse failed/i.test(message)) {
          throw new Error(`Failed to parse invoice data from LLM after ${attempt + 1} attempts`);
        }
        throw error;
      }

      attempt += 1;
      logInfo(`Retrying LLM extraction (${attempt}/${maxRetries})`);
      await delay(500);
    }
  }
}

async function uploadInvoiceToR2(fileData, fileName, contentType, env) {
  const extension = getFileExtension(fileName) || getExtensionFromMime(contentType) || 'jpg';
  const key = `invoices/${Date.now()}-${crypto.randomUUID()}.${extension}`;
  const putResult = await env.INVOICE_BUCKET.put(key, fileData, {
    httpMetadata: { contentType }
  });
  if (!putResult) {
    throw new Error('R2 upload failed');
  }
  logInfo('R2 upload success', key);
  return key;
}

async function deleteR2Object(key, env) {
  if (!env.INVOICE_BUCKET) {
    return;
  }
  await env.INVOICE_BUCKET.delete(key);
}

function getR2PublicUrl(key, env) {
  if (!env.R2_PUBLIC_BASE_URL) {
    throw new Error('Missing R2_PUBLIC_BASE_URL');
  }
  const publicBaseUrl = String(env.R2_PUBLIC_BASE_URL).replace(/\/$/, '');
  return `${publicBaseUrl}/${key}`;
}

function getFileExtension(fileName) {
  const match = String(fileName || '').match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toLowerCase() : null;
}

function getExtensionFromMime(mimeType) {
  if (!mimeType) return null;
  const normalized = mimeType.toLowerCase();
  if (normalized === 'image/jpeg') return 'jpg';
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'application/pdf') return 'pdf';
  return null;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeInvoiceData(data) {
  if (!data || typeof data !== 'object') {
    return null;
  }

  // If data has a 'header' property, extract from it
  const header = data.header || data;
  const lines = Array.isArray(data.lines) ? data.lines : [];
  // If no lines, but raw_lines exist, pass them through for next step
  const raw_lines = Array.isArray(data.raw_lines) ? data.raw_lines : undefined;

  return {
    partner_name: normalizeString(header.partner_name),
    date: normalizeDate(header.date),
    amount: normalizeAmount(header.amount),
    reference: normalizeString(header.reference),
    vat_no: normalizeString(header.vat_no),
    lines,
    ...(raw_lines ? { raw_lines } : {})
  };
}

function normalizeString(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function normalizeAmount(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    return parseNumberString(value);
  }
  return null;
}

function parseNumberString(value) {
  const normalized = String(value).trim().replace(/,/g, '');
  const arabicDigits = normalized
    .replace(/[٠١٢٣٤٥٦٧٨٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[۰۱۲۳۴۵۶۷۸۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  const number = Number(arabicDigits);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function isValidExtractedInvoiceData(data) {
  return !!data &&
    typeof data.partner_name === 'string' && data.partner_name.length > 0 &&
    typeof data.amount === 'number' &&
    Array.isArray(data.lines) &&
    data.lines.length > 0 && data.amount > 0;
}

function tryParseJsonCandidate(candidate) {
  const trimmed = candidate?.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    logInfo(`JSON parse failed for candidate length ${trimmed.length}: ${error.message}`);
    return null;
  }
}

function parseJsonFromString(text) {
  const direct = tryParseJsonCandidate(text);
  if (direct) return direct;

  const len = text.length;
  for (let start = text.indexOf('{'); start !== -1 && start < len; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < len; i++) {
      const ch = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          const candidate = text.slice(start, i + 1);
          const parsed = tryParseJsonCandidate(candidate);
          if (parsed) return parsed;
        }
      }
    }
  }

  return null;
}

function sanitizeJsonResponse(text) {
  let sanitized = text
    .replace(/`json|`/g, '')
    .replace(/```/g, '')
    .trim();

  // Remove any leading text before the first '{'
  const firstBrace = sanitized.indexOf('{');
  if (firstBrace > 0) {
    sanitized = sanitized.slice(firstBrace);
  }

  sanitized = sanitized
    .replace(/(\d+)\.(\d{3})\.(\d+)/g, '$1$2.$3')
    .replace(/(\d)_(\d)/g, '$1$2');

  return sanitized;
}

function parseAiJson(rawText) {
  const text = rawText?.trim();
  if (!text) {
    throw new Error('Empty response from AI when parsing invoice data');
  }

  const candidates = [];
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match[1]) {
      candidates.push(match[1].trim());
    }
  }

  const cleanedText = text
    .replace(/```(?:json)?\s*/gi, '')
    .replace(/```/g, '')
    .trim();

  candidates.push(cleanedText);
  candidates.push(text);

  logInfo(`parseAiJson: text length ${text.length}, candidates ${candidates.length}`);

  for (const [index, candidate] of candidates.entries()) {
    logInfo(`parseAiJson: trying candidate ${index + 1}/${candidates.length} length ${candidate.length}`);
    const parsed = parseJsonFromString(candidate);
    if (parsed) {
      logInfo(`parseAiJson: parsed candidate ${index + 1}. Result: ${JSON.stringify(parsed)}`);
      return parsed;
    }

    const cleanedCandidate = candidate
      .replace(/```(?:json)?/gi, '')
      .replace(/```/g, '')
      .trim();

    const firstBrace = cleanedCandidate.indexOf('{');
    const lastBrace = cleanedCandidate.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const fallbackCandidate = cleanedCandidate.slice(firstBrace, lastBrace + 1).trim();
      logInfo(`parseAiJson: trying fallback candidate from ${firstBrace} to ${lastBrace}, length ${fallbackCandidate.length}`);
      const fallbackParsed = tryParseJsonCandidate(fallbackCandidate);
      if (fallbackParsed) {
        logInfo(`parseAiJson: parsed fallback candidate ${index + 1}`);
        return fallbackParsed;
      }
    }
  }

  logError(`parseAiJson failed for response: ${text.substring(0, 500)}`);
  throw new Error(`Failed to parse AI JSON response: ${text}`);
}

function isPlaceholderValue(value) {
  return !value || /your[_\- ]|example|placeholder/i.test(value);
}

function validateOdooConfig(env) {
  const missing = [];
  if (isPlaceholderValue(env.ODOO_URL)) missing.push('ODOO_URL');
  if (isPlaceholderValue(env.ODOO_DB)) missing.push('ODOO_DB');
  if (isPlaceholderValue(env.ODOO_USER)) missing.push('ODOO_USER');
  if (isPlaceholderValue(env.ODOO_PWD)) missing.push('ODOO_PWD');

  if (missing.length) {
    throw new Error(`Missing or invalid Odoo configuration: ${missing.join(', ')}. Set valid Worker env bindings for ODOO_URL, ODOO_DB, ODOO_USER, and ODOO_PWD.`);
  }
}



async function createOdooBill(extractedData, env) {
  validateOdooConfig(env);

  const baseUrl = env.ODOO_URL.replace(/^https?:\/\//, '');
  const url = `https://${baseUrl}`;
  const db = env.ODOO_DB;
  const username = env.ODOO_USER;
  const password = env.ODOO_PWD;

  // Authenticate via JSON-RPC
  const authRequestBody = JSON.stringify({
    jsonrpc: '2.0',
    method: 'call',
    params: {
      db,
      login: username,
      password
    },
    id: Math.floor(Math.random() * 1000000000)
  });

  logInfo(`Odoo auth target: ${url}/web/session/authenticate, db=${db}, user=${username}`);
  const authResponse = await fetch(`${url}/web/session/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: authRequestBody
  });

  const authText = await authResponse.text();
  logInfo(`Odoo auth response text: ${authText.substring(0, 1000)}`);
  const setCookieHeader = authResponse.headers.get('set-cookie') || authResponse.headers.get('Set-Cookie');
  const cookieHeader = setCookieHeader
    ? setCookieHeader.split(/,\s*/).map(cookie => cookie.split(';')[0]).join('; ')
    : null;
  if (cookieHeader) {
    logInfo(`Odoo auth cookie header: ${cookieHeader}`);
  }

  let authData;
  try {
    authData = JSON.parse(authText);
  } catch (error) {
    throw new Error(`Odoo auth JSON parse failed: ${error.message}. Body: ${authText}`);
  }

  if (authData.error) {
    const debugInfo = authData.error.data?.debug || authData.error.data?.message || '';
    throw new Error(`Odoo auth failed: ${authData.error.message}${debugInfo ? ` | debug: ${debugInfo}` : ''}`);
  }

  const uid = authData.result.uid;
  const sessionId = authData.result.session_id;

  // Find or create partner
  let partnerIds = await odooCall('res.partner', 'search', [[['name', 'ilike', extractedData.partner_name]]], { limit: 1 }, url, db, uid, password, sessionId, cookieHeader);
  if (!partnerIds.length) {
    partnerIds = [await odooCall('res.partner', 'create', [{ name: extractedData.partner_name, supplier_rank: 1 }], {}, url, db, uid, password, sessionId, cookieHeader)];
  }

  // Find product

    // Find or create product for each line
    const getProductId = async (line) => {
      let productIds = await odooCall('product.product', 'search', [[['name', 'ilike', line.name]]], { limit: 1 }, url, db, uid, password, sessionId, cookieHeader);
      if (!productIds.length) {
        productIds = [await odooCall('product.product', 'create', [{ name: line.name }], {}, url, db, uid, password, sessionId, cookieHeader)];
      }
      return productIds[0];
    };

  // Create bill

    // Create bill
    const invoiceLines = [];
    for (const line of extractedData.lines) {
      const productId = await getProductId(line);
      invoiceLines.push([0, 0, {
        product_id: productId,
        name: line.name || 'AI Line',
        quantity: line.quantity || 1,
        price_unit: line.unit_price || 0
      }]);
    }
    const billVals = {
      move_type: 'in_invoice',
      partner_id: partnerIds[0],
      invoice_date: extractedData.date,
      ref: extractedData.reference,
      invoice_line_ids: invoiceLines
    };

  const sum = extractedData.lines.reduce((s, l) => s + (l.total || 0), 0);
  if (Math.abs(sum - extractedData.amount) > 10000) {
    logError('Line totals mismatch invoice total', { sum, amount: extractedData.amount });
  }
  return await odooCall('account.move', 'create', [billVals], {}, url, db, uid, password, sessionId, cookieHeader);
}

async function odooCall(model, method, args, kwargs, url, db, uid, password, sessionId, cookieHeader) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Openerp-Session-Id': sessionId
  };
  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }

  const response = await fetch(`${url}/web/dataset/call_kw/${model}/${method}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      params: {
        model,
        method,
        args,
        kwargs
      },
      id: Math.floor(Math.random() * 1000000000)
    })
  });

  const responseText = await response.text();
  logInfo(`Odoo call ${model}.${method} response text: ${responseText.substring(0, 1000)}`);

  let data;
  try {
    data = JSON.parse(responseText);
  } catch (error) {
    throw new Error(`Odoo call JSON parse failed for ${model}.${method}: ${error.message}. Body: ${responseText}`);
  }

  if (data.error) {
    throw new Error(`Odoo call failed: ${data.error.message}`);
  }

  return data.result;
}
