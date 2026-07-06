const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function fetchImageAsBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bild svarade ${res.status}`);
  const contentType = res.headers.get('content-type') || '';
  const match = /image\/(jpeg|png|gif|webp)/.exec(contentType);
  const media_type = match ? `image/${match[1]}` : 'image/jpeg';
  const buf = Buffer.from(await res.arrayBuffer());
  return { data: buf.toString('base64'), media_type };
}

/**
 * VISUAL VERIFY — before showing a Google Image Search result, send the
 * actual image to Claude Vision and ask whether it clearly shows the
 * scientific concept in a way suitable for year 7 students. Guardrail
 * against Google's image search returning something irrelevant, too
 * advanced, the wrong substance, or a literal illustration of a metaphor
 * instead of the real concept.
 *
 * (The concept/search query itself is generated once, up front, by
 * writer.js in the same call that writes voice_text — no separate
 * "pick a query" Claude call happens here.)
 */
async function verifyImageRelevance({ image_url, concept }) {
  try {
    const { data, media_type } = await fetchImageAsBase64(image_url);
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 5,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type, data } },
          { type: 'text', text: `Does this image clearly show "${concept}" suitable for year 7 students? Answer Yes or No only.

Answer No if any of these apply:
- The image is a university- or research-level diagram (e.g. quantum mechanics, orbital hybridization, advanced spectroscopy).
- The image shows a different chemical element, molecule or compound than the one described.
- The image is a research paper, textbook scan, or unrelated photo rather than a clear diagram.
- The image illustrates a metaphor or analogy literally (e.g. an actual rope, candy, or football) instead of the real scientific concept.

Answer Yes or No only.` }
        ]
      }]
    });

    const text = response.content[0].text.trim().toLowerCase();
    return text.startsWith('yes');
  } catch (e) {
    console.warn('Bildrelevanskontroll misslyckades:', e.message);
    return false;
  }
}

/**
 * VISUAL SUMMARY — last resort when neither Google Image Search nor DALL-E
 * produced a usable image. Gives a short Swedish phrase to display as large
 * text next to a subject icon in the placeholder, so the student still sees
 * something relevant to the scene instead of an empty box.
 */
async function summarizeConcept({ voice_text }) {
  const prompt = `Sammanfatta det vetenskapliga konceptet i denna text med max 3-4 ord på svenska, för visning som stor text i en enkel platshållarruta (används när ingen bild hittades): "${voice_text}"

Svara bara med sammanfattningen, inget annat.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 20,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text.trim().replace(/^["']|["']$/g, '').split('\n')[0].trim();
  return text || null;
}

module.exports = { verifyImageRelevance, summarizeConcept };
