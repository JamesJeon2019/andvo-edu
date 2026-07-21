const Anthropic = require('@anthropic-ai/sdk');
const { tryParseJson } = require('../utils/jsonParse');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DATA_URL_RE = /^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i;

function parseDataUrl(dataUrl) {
  const match = typeof dataUrl === 'string' ? DATA_URL_RE.exec(dataUrl) : null;
  if (!match) return null;
  const mediaType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1];
  return { mediaType, data: match[2] };
}

/**
 * LÄROBOKSLÄSARE — läser av foton av läroboksidor med Claude Vision och
 * transkriberar innehållet ordagrant, utan att lägga till eller sammanfatta
 * något. Resultatet används som det enda tillåtna källmaterialet av
 * planner.js/writer.js i "Skapa från lärobok"-läget.
 */
async function extractTextbookMaterial(images, language = 'sv') {
  const parsed = (Array.isArray(images) ? images : []).map(parseDataUrl).filter(Boolean);
  if (parsed.length === 0) {
    throw new Error('Inga giltiga bilder skickades');
  }

  const langName = language === 'en' ? 'English' : 'Swedish';

  const content = [
    ...parsed.map(img => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.data }
    })),
    {
      type: 'text',
      text: `These are photos of textbook pages, in reading order. Transcribe ALL readable text content from them completely and accurately, in ${langName}, preserving headings, paragraphs and lists as plain text.

Strict rules:
- Do not summarize, shorten or paraphrase — transcribe the actual text
- Do not add anything that is not visible in the photos
- Do not skip any paragraph, caption or list item
- If a word or passage is illegible, write [oläsligt] there instead of guessing

Return ONLY JSON, no markdown:
{
  "title": "a short title for this material, taken from its heading if there is one, otherwise inferred strictly from the visible content",
  "text": "the full transcribed text of all pages, in reading order"
}

Do not include any text before or after the JSON object. Do not write introductory phrases like "Here is...". Your entire reply must be valid JSON, starting with { and ending with }.`
    }
  ];

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content }]
  });

  let result = tryParseJson(response.content[0].text.trim());

  if (!result) {
    // Modellen svarade ändå med text runt JSON-objektet — ett enda
    // återförsök med en skarpare instruktion, innan vi ger upp.
    console.warn('Läroboksläsare: ogiltigt JSON-svar, gör ett återförsök med striktare instruktion');
    const retryResponse = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: 'Your previous reply included text outside the JSON object. Reply with ONLY the JSON object, no preamble, no explanation, starting with { and ending with }.',
      messages: [{ role: 'user', content }]
    });
    result = tryParseJson(retryResponse.content[0].text.trim());
  }

  if (!result) {
    throw new Error('Kunde inte tolka svaret från Vision som JSON');
  }

  if (!result.text || !result.text.trim()) {
    throw new Error('Kunde inte läsa någon text från bilderna');
  }

  return result;
}

module.exports = { extractTextbookMaterial, parseDataUrl };
