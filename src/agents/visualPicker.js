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
 * (image_search_query and image_concept are generated once, up front, by
 * writer.js in the same call that writes voice_text — no separate "pick a
 * query" Claude call happens here.)
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
          { type: 'text', text: `Look at this image. Does it clearly show "${concept}" in a way suitable for year 7 science students? Answer Yes or No only.

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
    console.warn('[visualPicker] Bildrelevanskontroll misslyckades:', e.message);
    return false;
  }
}

module.exports = { verifyImageRelevance };
