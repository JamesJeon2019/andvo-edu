const Anthropic = require('@anthropic-ai/sdk');
const sharp = require('sharp');
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

/**
 * DIAGRAMDETEKTOR — hittar enskilda läromedelsdiagram/scheman på fotona
 * (grafer, strukturformler, anatomiska scheman, processdiagram etc, INTE
 * vanlig text, texttabeller eller dekorativa foton) och förklarar deras
 * innehåll i ord. Första byggstenen för att i ett senare steg "grunda"
 * material-lägets illustrationer i de verkliga diagrammen i stället för
 * att gissa utifrån text i efterhand. Ett fristående, valfritt steg — ett
 * misslyckande här ska aldrig stoppa extractTextbookMaterial.
 */
async function detectDiagrams(images, language = 'sv') {
  const parsed = (Array.isArray(images) ? images : []).map(parseDataUrl).filter(Boolean);
  if (parsed.length === 0) {
    return { diagrams: [] };
  }

  const langName = language === 'en' ? 'English' : 'Swedish';

  const content = [
    ...parsed.map(img => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.data }
    })),
    {
      type: 'text',
      text: `These are photos of textbook pages, in reading order (index 0, 1, 2, ...).

Find any individual educational diagrams, charts or schematic illustrations on these pages — graphs, structural formulas, anatomical diagrams, process diagrams and similar. Do NOT count plain body text, tables of text, or decorative photos without an educational/explanatory purpose as diagrams.

For each diagram you find:
1. Give it a short label.
2. Explain its content in words, in ${langName}. You may use any caption or nearby text on the photo to make the explanation more accurate.
3. Give its location on that specific image as FRACTIONS of that image's own width/height (0.0-1.0 for left/top/width/height), NOT absolute pixels — the coordinates must be independent of the photo's actual resolution.

Return ONLY JSON, no markdown:
{
  "diagrams": [
    {
      "imageIndex": 0,
      "label": "short diagram name",
      "explanation": "detailed explanation of the diagram's content, in words",
      "bbox": { "left": 0.1, "top": 0.2, "width": 0.4, "height": 0.3 }
    }
  ]
}

If the pages contain no diagrams at all (text only), return { "diagrams": [] } — that is a normal, valid result, not an error.

Do not include any text before or after the JSON object. Do not write introductory phrases like "Here is...". Your entire reply must be valid JSON, starting with { and ending with }.`
    }
  ];

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    messages: [{ role: 'user', content }]
  });

  const result = tryParseJson(response.content[0].text.trim());
  if (!result || !Array.isArray(result.diagrams)) {
    return { diagrams: [] };
  }

  return result;
}

/**
 * DIAGRAMBESKÄRARE — skär ut den del av ett fotograferat läroboksuppslag
 * som en diagrams `bbox` (från detectDiagrams, fractions 0.0-1.0 relative
 * to the EXIF-rotated image) pekar ut, med lite padding runt om. Ett foto
 * taget i stående läge har ofta EXIF-orientering satt i stället för att
 * pixeldatan faktiskt är roterad — `.rotate()` (utan argument) läser av
 * den taggen och roterar på riktigt. `sharp`'s `.metadata()` rapporterar
 * alltid filens råa, opåverkade mått, så den kan INTE användas för att
 * få fram bredd/höjd efter rotation. Därför två pass: första passet kör
 * `.rotate().toBuffer({ resolveWithObject: true })`, vars `info.width`/
 * `info.height` är de faktiska måtten efter rotation; andra passet skapar
 * en ny `sharp`-instans av den redan roterade bufferten och gör
 * `.extract()` på den, med pixelkoordinater uträknade från just de måtten.
 */
async function cropDiagram(dataUrl, bbox, paddingFraction = 0.05) {
  try {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed || !bbox) return null;

    const sourceBuffer = Buffer.from(parsed.data, 'base64');

    const { data: rotatedBuffer, info } = await sharp(sourceBuffer)
      .rotate()
      .toBuffer({ resolveWithObject: true });

    const padX = bbox.width * paddingFraction;
    const padY = bbox.height * paddingFraction;

    const leftFrac = bbox.left - padX;
    const topFrac = bbox.top - padY;
    const widthFrac = bbox.width + 2 * padX;
    const heightFrac = bbox.height + 2 * padY;

    const left = Math.max(0, Math.round(leftFrac * info.width));
    const top = Math.max(0, Math.round(topFrac * info.height));
    const right = Math.min(info.width, Math.round((leftFrac + widthFrac) * info.width));
    const bottom = Math.min(info.height, Math.round((topFrac + heightFrac) * info.height));

    const width = right - left;
    const height = bottom - top;
    if (width <= 0 || height <= 0) return null;

    const croppedBuffer = await sharp(rotatedBuffer)
      .extract({ left, top, width, height })
      .jpeg({ quality: 85 })
      .toBuffer();

    return `data:image/jpeg;base64,${croppedBuffer.toString('base64')}`;
  } catch (e) {
    return null;
  }
}

module.exports = { extractTextbookMaterial, detectDiagrams, cropDiagram, parseDataUrl };
