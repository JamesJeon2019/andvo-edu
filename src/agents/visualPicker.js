const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * VISUAL VERIFY — before showing a Wikimedia result, ask Claude whether the
 * candidate image's title actually shows the scientific concept in a way
 * suitable for year 7-9. Guardrail against Commons' keyword search returning
 * something irrelevant, too advanced, the wrong substance, or a literal
 * illustration of a metaphor instead of the real concept.
 *
 * (image_search_query itself is generated once, up front, by writer.js in the
 * same call that writes voice_text — no separate "pick a query" Claude call
 * happens at render time.)
 */
async function verifyVisualMatch({ image_title, voice_text }) {
  const prompt = `Does an image titled "${image_title}" accurately show the scientific concept described in this text, in a way suitable for year 7 students: "${voice_text}"? Answer Yes or No only.

Answer No if any of these apply:
- The image is a university- or research-level diagram (e.g. quantum mechanics, orbital hybridization, advanced spectroscopy).
- The image shows a different chemical element, molecule or compound than the one described in the text.
- The text describes a single, simple molecule but the image shows multiple molecules, a molecular cluster, or bonds between separate molecules.
- The text describes an atom's structure but the image shows only the nucleus without electrons, or only electrons without a nucleus.
- The image illustrates a metaphor or analogy literally (e.g. an actual rope, candy, or football) instead of the real scientific concept.

Answer Yes or No only.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 5,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text.trim().toLowerCase();
  return text.startsWith('yes');
}

/**
 * VISUAL SUMMARY — last resort when no Wikimedia or Unsplash image passed
 * verification. Gives a short Swedish phrase to display as large text next to
 * a subject icon in the placeholder, so the student still sees something
 * relevant to the scene instead of an empty box.
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

module.exports = { verifyVisualMatch, summarizeConcept };
