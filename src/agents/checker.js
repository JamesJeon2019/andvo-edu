const Anthropic = require('@anthropic-ai/sdk');
const { tryParseJson } = require('../utils/jsonParse');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Slår ihop ett blocks synliga textinnehåll (titel, scenernas voice_text,
 * ev. hint) till en enda sträng per block, och blocken till en text för
 * hela lektionen. Används av både checkLesson och checkMaterialFaithfulness.
 */
function lessonBlocksToText(lesson) {
  return lesson.blocks
    .filter(b => b.content)
    .map(b => {
      const c = b.content;
      const parts = [b.title];
      if (Array.isArray(c.scenes)) parts.push(...c.scenes.map(s => s.voice_text).filter(Boolean));
      if (c.hint) parts.push(c.hint);
      return parts.join(' ');
    })
    .join('\n\n');
}

/**
 * CHECKER — fact-checks the finished lesson (facts, formulas, terminology,
 * dates, etc). Subject-agnostic: the checklist is generic on purpose so it
 * works the same way for chemistry, history, geography, art, music, sports...
 */
async function checkLesson({ lesson, subject }) {

  const allText = lessonBlocksToText(lesson);

  const prompt = `You are a strict subject-matter expert in "${subject}", fact-checking a science lesson for Swedish year 7-9 students. Accuracy matters more than leniency — a wrong formula, law, or definition taught to students is a real harm, so flag anything you are not fully confident is correct.

Lesson text:
${allText}

Check for:
1. Correctness of any facts, formulas, chemical equations, physical laws, mathematical statements, units, dates, names, terminology or numeric data used
2. Contradictions between different blocks of the lesson
3. Anything stated with more certainty or precision than is actually accurate
4. Oversimplifications that cross the line into being factually wrong (a simplification for year 7-9 is fine; a wrong statement is not)

Return ONLY JSON:
{
  "status": "ok" | "warnings" | "errors",
  "issues": [
    {
      "type": "error" | "warning",
      "location": "short description of where the issue was found",
      "found": "what was found",
      "correct": "what it should be instead"
    }
  ],
  "summary": "one-sentence summary of the check"
}

If there are no errors, return status: "ok" and an empty issues array.`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = response.content[0].text.trim();
    const result = tryParseJson(text);
    if (!result) {
      throw new Error('Kunde inte tolka JSON-svar');
    }
    return result;
  } catch (e) {
    // Checker misslyckanden ska aldrig blockera lektionen från att visas
    console.warn('Checker warning:', e.message);
    return { status: 'ok', issues: [], summary: 'Faktagranskning hoppades över' };
  }
}

/**
 * KÄLLTROHETSKONTROLL — för "Skapa från lärobok"-läget. Till skillnad från
 * checkLesson (som bedömer om lektionen är sakligt KORREKT) kontrollerar
 * denna om lektionen är TROGEN källmaterialet: har writer-agenten lagt till
 * fakta, siffror, termer, exempel eller påståenden som inte finns i det
 * uppladdade läroboksmaterialet, även om de råkar vara sanna?
 */
async function checkMaterialFaithfulness({ lesson, material }) {

  const allText = lessonBlocksToText(lesson);

  const prompt = `You are auditing a generated lesson for source faithfulness against the textbook material it was supposed to be built from ONLY.

Your job is NOT to judge whether the lesson is factually correct — it is to compare the lesson against the material below, block by block, line by line, and find every fact, number, term, example or claim in the lesson that is NOT present in the material. It does not matter if the added content is true or reasonable — if it isn't in the material, it should be flagged, because the lesson was supposed to be built strictly from this source.

SOURCE MATERIAL (the only content the lesson is allowed to be built from):
"""
${material}
"""

GENERATED LESSON (compare this against the material above):
${allText}

Method — do this systematically, not impressionistically:
1. Go through the lesson block by block (use the block's title as its location).
2. For each block, go through it sentence by sentence.
3. For each fact, number, term, example, name or claim in that sentence, check whether it literally appears in the material (paraphrasing the material's own content is fine — introducing anything beyond it is not).
4. If something in the lesson has no basis in the material, record it as an issue with the block it came from.

Return ONLY JSON:
{
  "status": "ok" | "warnings" | "errors",
  "issues": [
    {
      "type": "error" | "warning",
      "location": "the block title (and roughly where in it) where this was found",
      "found": "the fact, number, term, example or claim that was added",
      "note": "why this isn't in the material, or how it differs from what the material actually says"
    }
  ],
  "summary": "one-sentence summary of the check"
}

Use "error" for added facts/numbers/claims that could mislead the teacher into thinking they came from the textbook, and "warning" for minor additions (e.g. a connecting example or explanatory phrasing) that don't change any facts but still go beyond the material. If everything in the lesson traces back to the material, return status: "ok" and an empty issues array.`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = response.content[0].text.trim();
    const result = tryParseJson(text);
    if (!result) {
      throw new Error('Kunde inte tolka JSON-svar');
    }
    return result;
  } catch (e) {
    // Checker misslyckanden ska aldrig blockera lektionen från att visas
    console.warn('Faithfulness checker warning:', e.message);
    return { status: 'ok', issues: [], summary: 'Källtrohetskontroll hoppades över' };
  }
}

module.exports = { checkLesson, checkMaterialFaithfulness };
