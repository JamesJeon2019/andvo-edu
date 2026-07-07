const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SVG_TAG_RE = /^<svg[\s\S]*<\/svg>$/i;

/**
 * ILLUSTRATOR — genererar en enkel svartvit SVG-illustration som matchar
 * exakt det som förklaras i en scens voice_text.
 */
async function generateSVG(voice_text, block_type, subject, instruction = null) {
  const instructionLine = instruction ? `\nTeacher instruction: ${instruction}` : '';

  const prompt = `You are a scientific illustrator creating educational SVG diagrams
for Swedish year 7-9 students studying ${subject}.

The student is currently hearing this explanation: ${voice_text}

Create a simple SVG (viewBox='0 0 400 300') that shows EXACTLY
the scientific concept or process described in that text.
The illustration must match what is being explained word for word.

Strict rules:
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
- Return ONLY SVG code starting with <svg, absolutely nothing else${instructionLine}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }]
  });

  const raw = response.content[0].text.trim();
  const clean = raw.replace(/```svg|```xml|```/gi, '').trim();

  return sanitizeSVG(clean);
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

module.exports = { generateSVG };
