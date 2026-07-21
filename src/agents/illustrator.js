const Anthropic = require('@anthropic-ai/sdk');
const { Resvg } = require('@resvg/resvg-js');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SVG_TAG_RE = /^<svg[\s\S]*<\/svg>$/i;

/**
 * ILLUSTRATOR — genererar en enkel svartvit SVG-illustration som matchar
 * exakt det som förklaras i en scens voice_text.
 *
 * Modellen svarar i två steg: först ett kort resonemang i text (antal
 * element, ordning/riktning, exakta tal/vinklar), sedan SVG-koden. Detta
 * motverkar att diagram blir "på-känn-fel" (t.ex. fel antal spektralfärger,
 * eller en reflektionsstråle som går rakt igenom objektet). Endast
 * <svg>...</svg>-delen av svaret extraheras innan sanitizeSVG() anropas —
 * sanitizeSVG() ska aldrig behöva hantera resonemangstext, se dess
 * ^...$-regex.
 */
async function generateSVG(voice_text, block_type, subject, instruction = null) {
  const instructionLine = instruction ? `\nTeacher instruction: ${instruction}` : '';

  const prompt = `You are a scientific illustrator creating educational SVG diagrams
for Swedish year 7-9 students studying ${subject}.

The student is currently hearing this explanation: ${voice_text}

Respond in TWO PARTS, in this exact order:

PART 1 — Reasoning (plain text, 2-4 sentences, no SVG, no markup):
Before writing SVG, briefly state in words: how many elements must appear,
their exact order, and any specific numeric values — count them explicitly.
Then draw exactly that.

PART 2 — SVG code:
After the reasoning, create a simple SVG (viewBox='0 0 400 300') that shows
EXACTLY the scientific concept or process described in voice_text, matching
your PART 1 count and order precisely. The illustration must match what is
being explained word for word.

Strict rules for the SVG:
- Illustrate ONLY the specific concept in voice_text
- Use arrows to show direction, relationships and change
- Maximum 5 visual elements on screen
- ALL text labels inside SVG must be in Swedish only, never English
- Font size minimum 16px for all labels
- Add white background as first SVG element:
   <rect width='400' height='300' fill='white'/>
- All text labels: dark color #333333, never white or light colors
- All lines, arrows, borders: dark color #333333 or #000000
- Main elements background: white #ffffff with dark border
- Accent color for 1-2 key elements only: use #2563eb (blue)
   or #dc2626 (red) - never use light or pastel colors
- Every element must have high contrast against white background
- Never use: white text, light grey, yellow, light blue,
   or any color that is hard to see on white background
- No animation of any kind - completely static SVG
- No decorative elements beyond the white background above, no outer border
- No script tags or JavaScript inside SVG
- Scientific accuracy required - if unsure draw simpler not wrong

Technical drawing rules:
- Arrowheads: define a <marker> in <defs> with orient="auto-start-reverse"
   and reference it via marker-end (or marker-start) - never compute
   arrowhead coordinates by hand
- All lines and paths: stroke-linecap="round" and stroke-linejoin="round"
- All text labels: text-anchor="middle" and dominant-baseline="central",
   positioned at the exact coordinate they label

Subject-specific accuracy rules - apply whichever block matches "${subject}",
ignore the rest:
- Fysik: force/field vectors start at the center of the object they act on;
   compute angled vectors from formulas (dx = L*sin(angle), dy = -L*cos(angle)),
   never by eye. For light reflection: the end point of the incoming ray and
   the start point of the reflected ray must be the exact same point, lying
   ON the object's outline (never inside it, never passing through it) - there
   must be a visible angle/kink between the two rays, never a single straight
   line through the object. For diffuse reflection off an ordinary (non-mirror)
   surface: draw several rays spreading out from that point, not just one.
   The reflected ray (from the reflection point to the observer/eye) must
   never cross the object's own fill/body on its way there, even though the
   reflection point itself is correctly on the object's outline. Before
   picking coordinates for the light source and the eye, identify which
   single edge/side of the object the reflection point sits on (e.g. its
   left edge, or its top edge) - then place BOTH the light source AND the
   eye on that same outward side of the object, never on opposite sides of
   it. As a check: draw the straight line from the reflection point to the
   eye's coordinates and confirm in your head that for its entire length it
   stays outside the object's own x/y bounding box - if any part of that
   line would fall inside the object's shape, move the eye to a position on
   the correct outward side until it does not.
- Kemi: fixed bond length between atoms (50-60px), bond angles must match the
   real physical values (120 degrees for sp2, 109.5 or 90 degrees for sp3) -
   never approximate by eye.
- Biologi: use smooth Bezier curves for membranes/DNA/vessels, with clearly
   fixed, deliberate control points - not freehand wiggles.
- Matematik: for function graphs, explicitly compute the coordinates of each
   point before writing the path - never draw a curve by eye.

Return PART 1 as plain text, then PART 2 starting with <svg and ending with
</svg>. Do not wrap the SVG in markdown code fences.${instructionLine}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }]
  });

  const raw = response.content[0].text.trim();
  const withoutFences = raw.replace(/```svg|```xml|```/gi, '').trim();
  const clean = extractSVGTag(withoutFences);

  return sanitizeSVG(clean);
}

/**
 * Extraherar exakt <svg>...</svg>-delen ur modellens svar (från första '<svg'
 * till sista '</svg>'), så att resonemangstexten i PART 1 aldrig når
 * sanitizeSVG(). Om ingen <svg>-tagg hittas returneras texten oförändrad,
 * så att sanitizeSVG()'s regex fångar det som ett ogiltigt svar (→ null).
 */
function extractSVGTag(text) {
  const lower = text.toLowerCase();
  const start = lower.indexOf('<svg');
  const end = lower.lastIndexOf('</svg>');

  if (start === -1 || end === -1 || end < start) return text;

  return text.slice(start, end + '</svg>'.length).trim();
}

/**
 * Rensar bort script-taggar, event-handlers och javascript:-attribut, och
 * validerar sedan att resultatet faktiskt är en komplett <svg>...</svg>-sträng.
 * Ogiltigt eller osäkert innehåll → null (blockerar aldrig lektionen, se writer.js).
 */
function sanitizeSVG(svg) {
  const cleaned = svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:[^"'\s]*/gi, '')
    .trim();

  if (!SVG_TAG_RE.test(cleaned)) return null;

  return cleaned;
}

/**
 * Renderar en SVG-sträng till PNG server-side, uppskalad relativt illustratörens
 * viewBox (400x300) så att en Vision-kritiker kan se detaljer (antal element,
 * vinklar, färger) tydligt. Används bara internt för render→critique-loopen,
 * aldrig för att visa bilden för lärare/elev — frontend renderar svg_content direkt.
 * Ogiltig SVG → null, kastar aldrig (samma mönster som sanitizeSVG).
 */
function renderSVGToPNG(svgString, scale = 2.5) {
  try {
    const resvg = new Resvg(svgString, { fitTo: { mode: 'zoom', value: scale } });
    const pngData = resvg.render();
    const pngBuffer = pngData.asPng();
    return `data:image/png;base64,${pngBuffer.toString('base64')}`;
  } catch {
    return null;
  }
}

module.exports = { generateSVG, renderSVGToPNG };
