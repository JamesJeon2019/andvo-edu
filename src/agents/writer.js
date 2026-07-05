const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const levelMap = {
  weak:   'Объясняй очень просто. Используй аналогии из повседневной жизни. Избегай сложных терминов. Короткие предложения.',
  mid:    'Стандартная глубина объяснения. Используй примеры. Вводи термины с объяснением.',
  strong: 'Продвинутый уровень. Строгие научные определения. Сложные задачи. Можно использовать формулы.'
};

/**
 * Генерирует контент для одного блока урока
 */
async function writeBlock({ block, lessonContext, level, language }) {
  const lvlInstr = levelMap[level] || levelMap.mid;

  let prompt = '';

  if (block.type === 'lecture') {
    prompt = `Ты — учитель ${lessonContext.subject}. Напиши текст лекции для слайда.

Урок: ${lessonContext.title}
Блок: ${block.title}
Описание блока: ${block.description}
Уровень: ${lvlInstr}
Язык: ${language}

Верни ТОЛЬКО JSON:
{
  "lead": "одно предложение-hook который цепляет внимание (курсивом будет показан)",
  "highlight": "главная мысль блока — 1-2 предложения (выделенный блок)",
  "paragraphs": [
    "абзац 1 (3-4 предложения)",
    "абзац 2 (3-4 предложения)",
    "абзац 3 (опционально)"
  ],
  "voice_text": "текст для озвучки голосом — полный, естественный, без формул в виде символов, цифрами и словами"
}`;

  } else if (block.type === 'task') {
    prompt = `Ты — учитель ${lessonContext.subject}. Напиши задание для урока.

Урок: ${lessonContext.title}
Блок: ${block.title}
Описание: ${block.description}
Уровень: ${lvlInstr}
Язык: ${language}

Верни ТОЛЬКО JSON:
{
  "instruction": "короткое объяснение что нужно сделать",
  "task": "конкретное задание для ученика (может быть многострочным)",
  "hint": "подсказка (опционально, можно null)",
  "voice_text": "текст для озвучки задания голосом"
}`;

  } else if (block.type === 'test') {
    prompt = `Ты — учитель ${lessonContext.subject}. Создай проверочные вопросы.

Урок: ${lessonContext.title}
Уровень: ${lvlInstr}
Язык: ${language}

Верни ТОЛЬКО JSON:
{
  "questions": [
    { "q": "вопрос 1?", "type": "open" },
    { "q": "вопрос 2?", "type": "open" },
    { "q": "вопрос 3?", "type": "open" }
  ],
  "voice_text": "текст для озвучки — прочитай все вопросы"
}`;

  } else if (block.type === 'video') {
    // Для видео контент минимальный — учитель вставляет ссылку сам
    return {
      ...block,
      content: {
        instruction: block.description,
        youtube_query: block.youtube_query,
        youtube_url: block.youtube_url || null,
        voice_text: `Сейчас посмотрим видео по теме: ${block.title}. ${block.description}`
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
 * Генерирует контент для всех блоков урока последовательно
 */
async function writeLesson({ plan, level, language }) {
  const blocks = [];

  for (const block of plan.blocks) {
    console.log(`  ✍️  Writer: блок "${block.title}" (${block.type})`);
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
