const Anthropic = require('@anthropic-ai/sdk');
const { languageInstructionsFor } = require('./level');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * PLANNER — takes a topic and parameters, returns a JSON lesson plan.
 * Subject-agnostic: works for any school subject, not just science.
 * Always plans for Swedish year 7-9 — see level.js.
 */
async function planLesson({ topic, subject, level, duration = 60, language = 'sv' }) {
  const levelMap = {
    weak:   'basic level: simple explanations, real-life analogies, minimal terminology',
    mid:    'standard level: normal depth, examples, core terms explained',
    strong: 'advanced level: rigorous definitions, harder problems, deeper theory'
  };

  const prompt = `You are a pedagogical planning agent. Create a lesson plan for ${duration} minutes.

Subject: ${subject}
Lesson topic: ${topic}
Student level: ${levelMap[level] || levelMap.mid}
Lesson language: ${language}

${languageInstructionsFor(level)}

Return ONLY valid JSON, no markdown, no explanations:
{
  "title": "lesson title",
  "subject": "${subject}",
  "topic": "${topic}",
  "level": "${level}",
  "duration": ${duration},
  "language": "${language}",
  "goal": "the lesson's goal in one sentence",
  "blocks": [
    {
      "id": 1,
      "type": "lecture",
      "title": "block title",
      "duration": 10,
      "description": "short description of what this block covers",
      "visible": true
    },
    {
      "id": 2,
      "type": "video",
      "title": "video block title",
      "duration": 5,
      "description": "what the video should cover",
      "youtube_query": "what to search for on YouTube (in the lesson language)",
      "youtube_url": null,
      "visible": true
    },
    {
      "id": 3,
      "type": "task",
      "title": "task title",
      "duration": 8,
      "description": "task description",
      "visible": true
    },
    {
      "id": 4,
      "type": "test",
      "title": "Check yourself",
      "duration": 7,
      "description": "review questions",
      "visible": true
    }
  ]
}

Rules:
- Alternate block types: lecture → video/task → lecture → task → test
- REQUIRED: the plan MUST include exactly one block of type "video", regardless of student level. Never omit it for the "weak"/basic level — visual, moving demonstrations are especially important for weaker students, not optional extras.
- The sum of all block durations must equal ${duration} minutes
- Minimum 5 blocks, maximum 8
- Stay strictly within ${subject} — every block must teach ${subject} content. Do not drift into other subjects, even as analogies for block topics (analogies inside the explanations themselves are fine, see language rules above)
- Generate a lesson covering STRICTLY this exact topic: ${topic}
  Do not add related subjects or expand to broader curriculum.
  Every single block must be directly and only about ${topic}.
  If unsure whether something belongs - leave it out.
- Return JSON only`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text.trim();
  const clean = text.replace(/```json|```/g, '').trim();
  const plan = JSON.parse(clean);

  return ensureVideoBlock(plan, { topic, language });
}

/**
 * Säkerställer att planen alltid har exakt ett video-block, oavsett elevnivå.
 * Claude följer oftast prompten (se REQUIRED-regeln ovan), men video är för
 * viktigt för svagare elever för att lita enbart på prompt-efterlevnad — om
 * Claude ändå skulle utelämna det, lägger vi till ett själva.
 */
function ensureVideoBlock(plan, { topic, language }) {
  if (!Array.isArray(plan.blocks) || plan.blocks.some(b => b.type === 'video')) return plan;

  const maxId = plan.blocks.reduce((max, b) => Math.max(max, b.id || 0), 0);
  const videoBlock = language === 'en'
    ? {
        id: maxId + 1,
        type: 'video',
        title: `Watch: ${topic}`,
        duration: 5,
        description: `A short video demonstrating ${topic}.`,
        youtube_query: topic,
        youtube_url: null,
        visible: true
      }
    : {
        id: maxId + 1,
        type: 'video',
        title: `Se en video om: ${topic}`,
        duration: 5,
        description: `En kort video som visar ${topic}.`,
        youtube_query: topic,
        youtube_url: null,
        visible: true
      };

  // Sätts in efter det första blocket (oftast en lecture) så videon kommer
  // tidigt i lektionen, inte sist.
  const blocks = [...plan.blocks];
  blocks.splice(Math.min(1, blocks.length), 0, videoBlock);
  return { ...plan, blocks };
}

/**
 * PLANNER (material mode) — same as planLesson, but the ENTIRE plan must be
 * built only from the supplied material (a transcription of teacher-uploaded
 * textbook photos, see textbookReader.js). Used by "Skapa från lärobok".
 * No video block is planned, since a video is by definition content that
 * doesn't come from the uploaded material.
 */
async function planLessonFromMaterial({ material, subject, level, duration = 60, language = 'sv' }) {
  const levelMap = {
    weak:   'basic level: simple explanations, real-life analogies, minimal terminology',
    mid:    'standard level: normal depth, examples, core terms explained',
    strong: 'advanced level: rigorous definitions, harder problems, deeper theory'
  };

  const prompt = `You are a pedagogical planning agent. Create a lesson plan for ${duration} minutes, based STRICTLY on the material below — a transcription of textbook pages a teacher photographed.

Subject: ${subject}
Student level: ${levelMap[level] || levelMap.mid}
Lesson language: ${language}

${languageInstructionsFor(level)}

MATERIAL (verbatim transcription of the teacher's uploaded textbook pages — this is the ONLY source of content allowed):
"""
${material}
"""

Return ONLY valid JSON, no markdown, no explanations:
{
  "title": "lesson title, derived from the material",
  "subject": "${subject}",
  "topic": "a short topic label describing what the material covers",
  "level": "${level}",
  "duration": ${duration},
  "language": "${language}",
  "goal": "the lesson's goal in one sentence, based only on the material",
  "blocks": [
    {
      "id": 1,
      "type": "lecture",
      "title": "block title",
      "duration": 10,
      "description": "short description of what this block covers, taken from the material",
      "visible": true
    },
    {
      "id": 2,
      "type": "task",
      "title": "task title",
      "duration": 8,
      "description": "task description, based only on the material",
      "visible": true
    },
    {
      "id": 3,
      "type": "test",
      "title": "Check yourself",
      "duration": 7,
      "description": "review questions based only on the material",
      "visible": true
    }
  ]
}

Rules:
- STRICT SOURCE RULE: every block must be built ONLY from facts, explanations, examples and information that literally appear in the material above. Never add outside knowledge, context, real-world examples, or facts not present in the material — even if they are true and would normally help. If the material is incomplete on some point, keep the lesson incomplete on that point too rather than filling the gap.
- Do NOT include a block of type "video" — no video comes from the uploaded material, so this mode never has one
- Allowed block types: "lecture", "task", "test"
- The sum of all block durations must equal ${duration} minutes
- Minimum 3 blocks, maximum 8
- Cover the material in a logical teaching order (explain first, then practice, then review)
- Return JSON only`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text.trim();
  const clean = text.replace(/```json|```/g, '').trim();
  const plan = JSON.parse(clean);

  return { ...plan, material };
}

module.exports = { planLesson, planLessonFromMaterial };
