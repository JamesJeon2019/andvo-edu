const Anthropic = require('@anthropic-ai/sdk');
const { parseDataUrl } = require('./textbookReader');
const { tryParseJson } = require('../utils/jsonParse');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * SCENBILD-MATCHNING — för "Skapa från lärobok"-läget: avgör om något av
 * lärarens uppladdade läroboksfoton bokstavligen visar samma diagram
 * eller schema som en scens voice_text beskriver, och om så, använder
 * fotot som scenens illustration istället för en AI-genererad SVG.
 *
 * Anropas bara med de foton som redan finns (sourceImages) — gör inget
 * anrop alls om listan är tom, och kraschar aldrig pipelinen: vid ett
 * ogiltigt/otolkbart svar eller ett API-fel returneras block oförändrat.
 *
 * Vilka block som ska skickas hit (t.ex. bara lecture-block, inte
 * task/test) avgörs av anroparen — se writer.js i ett senare steg.
 */
async function assignSourceImages(block, sourceImages) {
  if (!Array.isArray(sourceImages) || sourceImages.length === 0) {
    return block;
  }

  const scenes = (block.content && block.content.scenes) || [];
  if (scenes.length === 0) return block;

  const parsedImages = sourceImages.map(parseDataUrl).filter(Boolean);
  if (parsedImages.length === 0) return block;

  const imageContent = [];
  parsedImages.forEach((img, i) => {
    imageContent.push({ type: 'text', text: `Image ${i}:` });
    imageContent.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.data }
    });
  });

  const sceneList = scenes
    .map((scene, i) => `${i}: ${scene.voice_text}`)
    .join('\n');

  const instructionText = `You are a strict reviewer matching textbook page photos to lesson scenes.

Above are ${parsedImages.length} photo(s) of textbook pages, labeled "Image 0" through "Image ${parsedImages.length - 1}".

Below are the scenes of a lesson block, each with its index and voice_text (what is explained in that scene):
${sceneList}

For each scene, decide if one of the photos ACTUALLY shows the exact same diagram, illustration or schematic that the scene's voice_text describes — not just "the same topic" or "the same textbook page/paragraph", but literally the same specific diagram/figure being talked about. Only include a match when you are confident the photo depicts that precise diagram; if in doubt, leave the scene out.

Return ONLY JSON:
{ "assignments": [{ "sceneIndex": 0, "imageIndex": 2 }] }

Scenes with no confident match must not appear in "assignments". If no scene has a confident match, return an empty array.`;

  const content = [...imageContent, { type: 'text', text: instructionText }];

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{ role: 'user', content }]
    });

    const result = tryParseJson(response.content[0].text.trim());
    if (!result || !Array.isArray(result.assignments)) return block;

    for (const assignment of result.assignments) {
      const { sceneIndex, imageIndex } = assignment || {};
      if (
        Number.isInteger(sceneIndex) && scenes[sceneIndex] &&
        Number.isInteger(imageIndex) && sourceImages[imageIndex]
      ) {
        scenes[sceneIndex].custom_image = sourceImages[imageIndex];
      }
    }

    return block;
  } catch (err) {
    console.error('Scene image matcher error:', err.message);
    return block;
  }
}

module.exports = { assignSourceImages };
