const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * PLANNER — принимает тему и параметры, возвращает JSON-план урока
 */
async function planLesson({ topic, subject, level, duration = 60, language = 'sv' }) {
  const levelMap = {
    weak:   'слабый уровень: простые объяснения, аналогии из жизни, минимум терминов',
    mid:    'средний уровень: стандартная глубина, примеры, базовые формулы',
    strong: 'продвинутый уровень: строгие определения, сложные задачи, теория'
  };

  const prompt = `Ты — педагогический агент. Создай план урока на ${duration} минут.

Тема: ${topic}
Предмет: ${subject}
Уровень учеников: ${levelMap[level] || levelMap.mid}
Язык урока: ${language}

Верни ТОЛЬКО валидный JSON без markdown, без пояснений:
{
  "title": "название урока",
  "subject": "${subject}",
  "topic": "${topic}",
  "level": "${level}",
  "duration": ${duration},
  "language": "${language}",
  "goal": "цель урока одним предложением",
  "keywords": ["ключевое слово 1", "ключевое слово 2", "ключевое слово 3"],
  "blocks": [
    {
      "id": 1,
      "type": "lecture",
      "title": "название блока",
      "duration": 10,
      "description": "краткое описание что будет в этом блоке",
      "image_query": "запрос для поиска фото (на английском)",
      "visible": true
    },
    {
      "id": 2,
      "type": "video",
      "title": "название видео-блока",
      "duration": 5,
      "description": "что должно быть в видео",
      "youtube_query": "что искать на YouTube (на языке урока)",
      "youtube_url": null,
      "visible": true
    },
    {
      "id": 3,
      "type": "task",
      "title": "название задания",
      "duration": 8,
      "description": "описание задания",
      "image_query": "запрос для фото",
      "visible": true
    },
    {
      "id": 4,
      "type": "test",
      "title": "Проверь себя",
      "duration": 7,
      "description": "проверочные вопросы",
      "visible": true
    }
  ]
}

Правила:
- Чередуй типы: lecture → video/task → lecture → task → test
- Сумма duration всех блоков = ${duration} минут
- image_query всегда на английском для лучшего поиска фото
- Минимум 5 блоков, максимум 8
- Верни только JSON`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text.trim();
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

module.exports = { planLesson };
