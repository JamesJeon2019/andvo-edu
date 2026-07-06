const Anthropic = require('@anthropic-ai/sdk');
const { detectGradeLevel, languageInstructionsFor } = require('./gradeLevel');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const levelMap = {
  weak:   'Explain very simply. Use everyday-life analogies. Avoid advanced terminology. Short sentences.',
  mid:    'Standard depth of explanation. Use examples. Introduce terms with an explanation.',
  strong: 'Advanced level. Rigorous, precise definitions. Harder problems. Formulas are fine.'
};

const VOICE_STYLE_INSTR = `VOICE_TEXT STYLE (STRICT):
- voice_text must sound like a real teacher speaking out loud to the class — warm, natural spoken language, never a textbook sentence.
- Spell out every formula, chemical symbol or mathematical notation as spoken words in the lesson language — never write symbols as-is in voice_text.
  Examples (Swedish): "H2O" → "H två O", "Na⁺" → "Na plus", "CO2" → "C O två", "2H2 + O2" → "två H två plus O två".
  Examples (English): "H2O" → "H two O", "Na⁺" → "Na plus".`;

/**
 * Genererar innehåll för ett enskilt lektionsblock. Fungerar likadant oavsett
 * ämne — prompten tar bara emot ämnet som en variabel, ingen ämnesspecifik logik.
 */
async function writeBlock({ block, lessonContext, level, language }) {
  const lvlInstr = levelMap[level] || levelMap.mid;
  const gradeLevel = lessonContext.gradeLevel || detectGradeLevel(lessonContext.topic || lessonContext.title, level);
  const langInstr = languageInstructionsFor(gradeLevel);
  const isBasic = gradeLevel !== 'highschool';
  const sceneLenRule = isBasic
    ? 'Max 2-3 sentences per scene (voice_text) — short, simple sentences, ONE concept at a time.'
    : '2-4 sentences per scene.';

  let prompt = '';

  if (block.type === 'lecture') {
    prompt = `You are a ${lessonContext.subject} teacher. Write the lecture content as a series of "scenes" — like a video presentation, where each scene is narrated aloud and paired with its own image.

Lesson: ${lessonContext.title}
Block: ${block.title}
Block description: ${block.description}
Level: ${lvlInstr}
Language: ${language}

${langInstr}

${VOICE_STYLE_INSTR}

Return ONLY JSON:
{
  "scenes": [
    {
      "voice_text": "the scene's text in the lesson language — this is exactly what is both shown on screen and spoken aloud",
      "visual_keywords": "2-5 ENGLISH keywords describing what this specific scene is about, used only as a fallback for image search",
      "emphasis": false
    }
  ]
}

Rules:
- 4-6 scenes per block
- First scene is a short "hook", 1 sentence to grab attention (emphasis: false)
- Exactly one scene is the block's main idea, mark it "emphasis": true
- The rest are explanation scenes. ${sceneLenRule}
- Each scene's visual_keywords must match that scene's own voice_text, not the whole block`;

  } else if (block.type === 'task') {
    prompt = `You are a ${lessonContext.subject} teacher. Write a lesson task as narrated scenes.

Lesson: ${lessonContext.title}
Block: ${block.title}
Description: ${block.description}
Level: ${lvlInstr}
Language: ${language}

${langInstr}

${VOICE_STYLE_INSTR}

Return ONLY JSON:
{
  "scenes": [
    { "voice_text": "short explanation of what to do", "visual_keywords": "2-5 English keywords", "emphasis": false },
    { "voice_text": "the actual task for the student (can be multi-line)", "visual_keywords": "2-5 English keywords", "emphasis": true }
  ],
  "hint": "a hint (optional, can be null)"
}

Rules:
- Exactly 2 scenes: (1) explanation, (2) the task itself with "emphasis": true
- ${sceneLenRule}
- Each scene's visual_keywords must match that specific scene's content`;

  } else if (block.type === 'test') {
    prompt = `You are a ${lessonContext.subject} teacher. Create review questions as narrated scenes — one scene = one question.

Level: ${lvlInstr}
Language: ${language}

${langInstr}

${VOICE_STYLE_INSTR}

Return ONLY JSON:
{
  "scenes": [
    { "voice_text": "1. Full question text, starting with its number?", "visual_keywords": "2-5 English keywords for this question's topic", "emphasis": false }
  ]
}

Rules:
- 3-5 scenes, one scene = one question
- Each voice_text must start with the question number, e.g. "1. ..."
- visual_keywords must match this specific question's topic, not the whole test`;

  } else if (block.type === 'video') {
    // Minimalt innehåll för video-block — läraren väljer/klistrar in länken själv
    const introByLang = {
      sv: `Nu ska vi titta på en video om: ${block.title}. ${block.description}`,
      en: `Now let's watch a video about: ${block.title}. ${block.description}`
    };
    return {
      ...block,
      content: {
        scenes: [{
          voice_text: introByLang[language] || introByLang.sv,
          visual_keywords: block.title,
          emphasis: false
        }],
        youtube_query: block.youtube_query,
        youtube_url: block.youtube_url || null
      }
    };
  }

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text.trim();
  const clean = text.replace(/```json|```/g, '').trim();
  const content = JSON.parse(clean);

  return { ...block, content };
}

/**
 * Genererar innehåll för alla lektionsblock, ett i taget.
 */
async function writeLesson({ plan, level, language }) {
  const blocks = [];

  for (const block of plan.blocks) {
    console.log(`  ✍️  Writer: block "${block.title}" (${block.type})`);
    const written = await writeBlock({
      block,
      lessonContext: plan,
      level,
      language
    });
    blocks.push(written);
  }

  return { ...plan, blocks };
}

module.exports = { writeLesson, writeBlock };
