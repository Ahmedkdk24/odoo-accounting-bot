import { logInfo, logError } from '../utils.js';
import { downloadTelegramFile, sendPlainText } from '../services/telegram.js';
import Groq from 'groq-sdk';
import * as pdfjsLib from 'pdfjs-dist';

const SECRET_HEADER = 'X-Telegram-Bot-Api-Secret-Token';

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

  const chatId = message.chat.id;
  if (message.text) {
    const text = message.text.trim();
    if (text.startsWith('/start') || text.startsWith('/help')) {
      await sendPlainText(chatId, 'Send an invoice PDF or image to create an Odoo bill.');
      return new Response('Ok');
    }
    await sendPlainText(chatId, 'Please send a PDF or image invoice. Text messages are not processed.');
    return new Response('Ok');
  }

  const filePayload = getTelegramFilePayload(message);
  if (!filePayload) {
    await sendPlainText(chatId, 'Send an invoice PDF or an invoice image to process.');
    return new Response('Ok');
  }

  try {
    const fileBase64 = await downloadTelegramFile(filePayload.fileId);
    const extractedData = await processInvoice(fileBase64, filePayload.mimeType, env);
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

async function processInvoice(fileBase64, mimeType, env) {
  if (!env.GROQ_API_KEY) {
    throw new Error('Missing GROQ_API_KEY secret');
  }

  const groq = new Groq({ apiKey: env.GROQ_API_KEY });
  
  let invoiceContent = '';
  
  if (mimeType === 'application/pdf') {
    invoiceContent = await extractTextFromPDF(fileBase64);
  } else if (mimeType.startsWith('image/')) {
    invoiceContent = await extractTextFromImage(fileBase64, mimeType, env);
  }

  const messages = [
    {
      role: 'user',
      content: `You are a professional Saudi accountant. Extract financial data from the following invoice text. Return ONLY a valid JSON object with keys: 'partner_name', 'date' (YYYY-MM-DD), 'amount' (float), 'reference' (invoice number), 'vat_no'. Do not include any explanation, markdown, code fences, or extra text. Invoice text:\n${invoiceContent}`
    }
  ];

  try {
    logInfo(`Sending request to Groq with ${messages.length} messages`);
    const chatCompletion = await groq.chat.completions.create({
      messages: messages,
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      temperature: 1,
      max_completion_tokens: 2048,
      top_p: 1,
      stream: false,
      stop: null
    });

    logInfo('Groq API call successful');
    const responseText = chatCompletion.choices[0]?.message?.content?.trim();
    if (!responseText) {
      throw new Error('Empty response from Groq API');
    }

    logInfo(`Groq response length: ${responseText.length}`);
    logInfo(`Groq preview: ${responseText.substring(0, 200)}...`);
    return parseAiJson(responseText);
  } catch (error) {
    logError('Groq API call failed', error);
    const message = error?.message || String(error);
    if (/401|PERMISSION_DENIED|Unauthorized|API key/i.test(message)) {
      throw new Error(`Groq API key rejected: ${message}`);
    }
    if (/503|Service Unavailable|UNAVAILABLE|timeout/i.test(message)) {
      throw new Error(`Groq API unavailable: ${message}`);
    }
    throw error;
  }
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

async function extractTextFromPDF(base64Data) {
  const pdfData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
  const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(item => item.str).join(' ');
    fullText += pageText + '\n';
  }

  return fullText;
}

async function extractTextFromImage(base64Data, mimeType, env) {
  const normalizedMime = mimeType || 'image/jpeg';
  const apiKey = env.OCR_SPACE_API_KEY || 'helloworld'; // 'helloworld' for anonymous usage
  const language = env.OCR_SPACE_LANGUAGE || 'eng';

  const doOcr = async (lang) => {
    const formData = new FormData();
    formData.append('base64Image', `data:${normalizedMime};base64,${base64Data}`);
    formData.append('language', lang);
    formData.append('isOverlayRequired', 'false');
    formData.append('isCreateSearchablePdf', 'false');
    formData.append('isSearchablePdfHideTextLayer', 'true');
    formData.append('apikey', apiKey);

    const response = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      body: formData
    });

    const result = await response.json();
    logInfo(`OCR.space response: ${JSON.stringify(result).substring(0, 500)}`);

    if (!result.IsErroredOnProcessing && result.ParsedResults && result.ParsedResults.length > 0) {
      return result.ParsedResults[0].ParsedText;
    }

    const errorMessage = Array.isArray(result.ErrorMessage)
      ? result.ErrorMessage.join('; ')
      : result.ErrorMessage || 'Unknown error';
    const errorDetails = result.ErrorDetails ? ` Details: ${result.ErrorDetails}` : '';
    throw new Error(`OCR failed: ${errorMessage}${errorDetails}`);
  };

  try {
    return await doOcr(language);
  } catch (error) {
    if (error.message.includes("parameter 'language'") && language.includes('+')) {
      const fallbackLanguage = language.split('+')[0];
      logInfo(`OCR.space invalid language '${language}', retrying with '${fallbackLanguage}'`);
      return await doOcr(fallbackLanguage);
    }
    throw error;
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
  logInfo(`Odoo auth request body: ${authRequestBody}`);
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
  const productIds = await odooCall('product.product', 'search', [[['name', '=', 'AI Automated Entry']]], { limit: 1 }, url, db, uid, password, sessionId, cookieHeader);
  if (!productIds.length) {
    throw new Error('Product "AI Automated Entry" not found');
  }

  // Create bill
  const billVals = {
    move_type: 'in_invoice',
    partner_id: partnerIds[0],
    invoice_date: extractedData.date,
    ref: extractedData.reference,
    invoice_line_ids: [[0, 0, {
      product_id: productIds[0],
      name: 'AI Automated Entry / إدخال آلي',
      quantity: 1,
      price_unit: parseFloat(extractedData.amount)
    }]]
  };

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
