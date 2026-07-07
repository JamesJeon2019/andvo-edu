const Anthropic = require('@anthropic-ai/sdk');
const { languageInstructionsFor } = require('./level');
const { generateSVG } = require('./illustrator');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const levelMap = {
  weak:   'Explain very simply. Use everyday-life analogies. Avoid advanced terminology. Short sentences.',
  mid:    'Standard depth of explanation. Use examples. Introduce terms with an explanation.',
  strong: 'Advanced level. Rigorous, precise definitions. Harder problems. Formulas are fine.'
};

const VOICE_STYLE_INSTR = `VOICE_TEXT STYLE (STRICT):
- voice_text must sound like a real teacher speaking out loud to the class — warm, natural spoken language, never a textbook sentence.
- Spell out every formula, chemical symbol or mathematical notation as spoken words in the lesson language — never write symbols as-is in voice_text.
  Examples (Swedish): "H2O" → "H två O", "Na⁺" → "Na plus", "CO2" → "CO två", "O2" → "O två".
  Examples (English): "H2O" → "H two O", "Na⁺" → "Na plus".`;

const SCENE_LEN_RULE = 'Max 2-3 sentences per scene (voice_text) — short, simple sentences, ONE concept at a time.';

/**
 * Genererar innehåll för ett enskilt lektionsblock. Fungerar likadant oavsett
 * ämne — prompten tar bara emot ämnet som en variabel, ingen ämnesspecifik logik.
 */
async function writeBlock({ block, lessonContext, level, language }) {
  const lvlInstr = levelMap[level] || levelMap.mid;
  const langInstr = languageInstructionsFor(level);

  let prompt = '';

  if (block.type === 'lecture') {
    prompt = `You are a ${lessonContext.subject} teacher. Write the lecture content as a series of "scenes" — like a video presentation, where each scene is narrated aloud.

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
      "emphasis": false
    }
  ]
}

Rules:
- 4-6 scenes per block
- First scene is a short "hook", 1 sentence to grab attention (emphasis: false)
- Exactly one scene is the block's main idea, mark it "emphasis": true
- The rest are explanation scenes. ${SCENE_LEN_RULE}`;

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
    { "voice_text": "short explanation of what to do", "emphasis": false },
    { "voice_text": "the actual task for the student (can be multi-line)", "emphasis": true }
  ],
  "hint": "a hint (optional, can be null)"
}

Rules:
- Exactly 2 scenes: (1) explanation, (2) the task itself with "emphasis": true
- ${SCENE_LEN_RULE}`;

  } else if (block.type === 'test') {
    prompt = `You are a ${lessonContext.subject} teacher. Create review questions as narrated scenes — one scene = one question.

Level: ${lvlInstr}
Language: ${language}

${langInstr}

${VOICE_STYLE_INSTR}

Return ONLY JSON:
{
  "scenes": [
    { "voice_text": "1. Full question text, starting with its number?", "emphasis": false }
  ]
}

Rules:
- 3-5 scenes, one scene = one question
- Each voice_text must start with the question number, e.g. "1. ..."`;

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

  if (Array.isArray(content.scenes)) {
    await illustrateScenes(content.scenes, block.type, lessonContext.subject);
  }

  return { ...block, content };
}

/**
 * Genererar en SVG-illustration per scen, en i taget (sekventiellt, inte
 * parallellt). Ett enskilt misslyckande får aldrig stoppa hela lektionen —
 * scenen får då bara svg_content: null.
 */
async function illustrateScenes(scenes, blockType, subject) {
  for (const scene of scenes) {
    scene.svg_content = await generateSVGWithRetry(scene.voice_text, blockType, subject);
  }
}

/**
 * Anropar illustrator-agenten. Vid rate limit (429) väntas 2 sekunder och
 * anropet görs om exakt en gång — misslyckas det igen, eller vid något annat
 * fel, loggas det och funktionen returnerar null istället för att kasta.
 */
async function generateSVGWithRetry(voiceText, blockType, subject) {
  try {
    return await generateSVG(voiceText, blockType, subject);
  } catch (err) {
    if (err.status === 429) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      try {
        return await generateSVG(voiceText, blockType, subject);
      } catch (retryErr) {
        console.error('Illustrator error (after 429 retry):', retryErr.message);
        return null;
      }
    }
    console.error('Illustrator error:', err.message);
    return null;
  }
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
