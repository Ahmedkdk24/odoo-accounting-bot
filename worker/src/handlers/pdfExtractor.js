// PDF.js is not compatible with Cloudflare Workers due to Node.js dependencies
// Using a simplified PDF text extraction that works in Workers runtime


// PDF text extraction is disabled. Use CloudConvert API instead.
export async function extractTextFromPdfUrl(pdfUrl) {
  throw new Error('PDF text extraction is disabled. Use CloudConvert API for PDF to image conversion.');
}

async function extractTextFromPDF(arrayBuffer) {
  const pdfBytes = new Uint8Array(arrayBuffer);
  const pdfStr = new TextDecoder('latin1').decode(pdfBytes);

  // Extract text from PDF objects more intelligently
  const textObjects = [];

  // Look for text objects in content streams (between BT and ET)
  const textObjectRegex = /BT\s*([\s\S]*?)\s*ET/gs;
  let match;

  while ((match = textObjectRegex.exec(pdfStr)) !== null) {
    const textContent = match[1];
    const strings = extractTextFromTextObject(textContent);
    textObjects.push(...strings);
  }

  // If no text objects found, try extracting from all parentheses (fallback)
  if (textObjects.length === 0) {
    const stringRegex = /\(([\\\(\)]*(?:[^\\()]|\\.)*?)\)/g;
    while ((match = stringRegex.exec(pdfStr)) !== null) {
      const raw = match[1];
      const decoded = decodePdfString(raw);
      if (decoded && decoded.trim().length > 2) {
        textObjects.push(decoded);
      }
    }
  }

  // Filter and deduplicate
  const filtered = textObjects
    .filter(str => {
      const trimmed = str.trim();
      return trimmed.length >= 2 &&
             !/^[\da-f]{8,}$/i.test(trimmed) &&
             !/^[\/\\\-_\.\s]*$/.test(trimmed) &&
             !/^T[jmf]\s*$/.test(trimmed) && // Filter out font operators
             !/^[\d\.]+\s+[\d\.]+\s+Td?$/.test(trimmed); // Filter out positioning operators
    })
    .filter((str, index, arr) => arr.indexOf(str) === index); // Remove duplicates

  return filtered.join(' ');
}

function extractTextFromTextObject(textContent) {
  const strings = [];
  const stringRegex = /\(([\\\(\)]*(?:[^\\()]|\\.)*?)\)/g;
  let match;

  while ((match = stringRegex.exec(textContent)) !== null) {
    const raw = match[1];
    const decoded = decodePdfString(raw);
    if (decoded && decoded.trim().length > 0) {
      strings.push(decoded);
    }
  }

  return strings;
}

function decodePdfString(raw) {
  if (!raw) return '';

  // Handle UTF-16 BOM
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i) & 0xff;
  }

  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    try {
      return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    } catch (e) {
      return raw;
    }
  }

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    try {
      return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    } catch (e) {
      return raw;
    }
  }

  // Handle escape sequences
  let result = '';
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (char === '\\' && i + 1 < raw.length) {
      const next = raw[++i];
      if (next >= '0' && next <= '7') {
        let oct = next;
        for (let j = 0; j < 2 && i + 1 < raw.length && /[0-7]/.test(raw[i + 1]); j++) {
          oct += raw[++i];
        }
        result += String.fromCharCode(parseInt(oct, 8));
      } else {
        switch (next) {
          case 'n': result += '\n'; break;
          case 'r': result += '\r'; break;
          case 't': result += '\t'; break;
          case 'b': result += '\b'; break;
          case 'f': result += '\f'; break;
          case '(':
          case ')':
          case '\\': result += next; break;
          default: result += next; break;
        }
      }
    } else {
      result += char;
    }
  }

  return result;
}

function calculateGarbageRatio(text) {
  if (!text) return 1;

  const totalChars = text.length;
  let garbageChars = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const code = char.charCodeAt(0);

    // Count as garbage: control chars, high unicode, or non-printable
    if (code < 32 || code > 126) {
      if (!(code >= 0x0600 && code <= 0x06FF) && // Arabic range
          !(code >= 0x0750 && code <= 0x077F) && // Extended Arabic
          code !== 0x000A && // newline
          code !== 0x000D) { // carriage return
        garbageChars++;
      }
    }
  }

  return garbageChars / totalChars;
}

export function normalizeExtractedPdfText(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ *\n */g, '\n')
    .trim();
}
