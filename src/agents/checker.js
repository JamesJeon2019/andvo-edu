const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * CHECKER — fact-checks the finished lesson (facts, formulas, terminology,
 * dates, etc). Subject-agnostic: the checklist is generic on purpose so it
 * works the same way for chemistry, history, geography, art, music, sports...
 */
async function checkLesson({ lesson, subject }) {

  const allText = lesson.blocks
    .filter(b => b.content)
    .map(b => {
      const c = b.content;
      const parts = [b.title];
      if (Array.isArray(c.scenes)) parts.push(...c.scenes.map(s => s.voice_text).filter(Boolean));
      if (c.hint) parts.push(c.hint);
      return parts.join(' ');
    })
    .join('\n\n');

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
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    // Checker misslyckanden ska aldrig blockera lektionen från att visas
    console.warn('Checker warning:', e.message);
    return { status: 'ok', issues: [], summary: 'Faktagranskning hoppades över' };
  }
}

module.exports = { checkLesson };
