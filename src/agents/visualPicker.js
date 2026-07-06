const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * VISUAL PICKER — Claude decides, per scene, what Wikimedia search query best
 * illustrates the scientific concept in that scene's voice_text. Subject
 * scope is science (Kemi, Biologi, Fysik, Matematik) but nothing here is
 * hardcoded per subject — Claude reads voice_text and decides.
 *
 * If a previous query already failed the relevance check (see
 * verifyVisualMatch below), pass it as `previous_query` so Claude tries a
 * genuinely different query instead of repeating the same failed search.
 */
async function pickVisual({ voice_text, previous_query }) {
  const retryNote = previous_query
    ? `\n\nThe query "${previous_query}" did not find a good match. Generate a DIFFERENT search query instead — do not repeat it.`
    : '';

  const prompt = `This is science education text for Swedish year 7-9 students: "${voice_text}"

Generate the best Wikimedia Commons search query (3-5 English words) to find a simple clear educational diagram that shows exactly what is being explained. Scientific diagrams are preferred over photos.${retryNote}

Rules:
- Never aim for university- or research-level diagrams — this is for a 13-15 year old, not a researcher.
- If the text uses an everyday analogy or metaphor (e.g. friends, a bag of candy, a football team, a rope, a robbery) instead of scientific terms, search for the actual scientific concept being taught, not the metaphor itself.
- Black-and-white diagrams and sketches are perfectly fine — accuracy and relevance beat color or decoration.

Return only the search query.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 40,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text.trim();
  const search_query = text.replace(/^["']|["']$/g, '').split('\n')[0].trim();

  if (!search_query) {
    throw new Error('Claude returned an empty search query');
  }
  return { search_query };
}

/**
 * VISUAL VERIFY — before showing a Wikimedia result, ask Claude whether the
 * candidate image's title actually shows the scientific concept in a way
 * suitable for year 7-9. Guardrail against Commons' keyword search returning
 * something irrelevant, too advanced, the wrong substance, or a literal
 * illustration of a metaphor instead of the real concept.
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
 * VISUAL SUMMARY — last resort when no Wikimedia image passed verification
 * after all retry attempts. Gives a short Swedish phrase to display as large
 * text in a colored placeholder box, so the student still sees something
 * relevant to the scene instead of an empty box.
 */
async function summarizeConcept({ voice_text }) {
  const prompt = `Sammanfatta det vetenskapliga konceptet i denna text med max 3-4 ord på svenska, för visning som stor text i en enkel färgad platshållarruta (används när ingen bild hittades): "${voice_text}"

Svara bara med sammanfattningen, inget annat.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 20,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text.trim().replace(/^["']|["']$/g, '').split('\n')[0].trim();
  return text || null;
}

module.exports = { pickVisual, verifyVisualMatch, summarizeConcept };
