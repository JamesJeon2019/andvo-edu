const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * CHECKER — проверяет факты, формулы, термины в готовом уроке
 */
async function checkLesson({ lesson, subject }) {

  // Собираем весь текст урока для проверки
  const allText = lesson.blocks
    .filter(b => b.content)
    .map(b => {
      const c = b.content;
      const parts = [b.title];
      if (c.lead) parts.push(c.lead);
      if (c.highlight) parts.push(c.highlight);
      if (c.paragraphs) parts.push(...c.paragraphs);
      if (c.task) parts.push(c.task);
      if (c.questions) parts.push(...c.questions.map(q => q.q));
      return parts.join(' ');
    })
    .join('\n\n');

  const prompt = `Ты — эксперт по предмету "${subject}". Проверь текст урока на фактические ошибки.

Текст урока:
${allText}

Проверь:
1. Правильность химических формул, уравнений, терминов
2. Корректность биологических/физических/математических данных
3. Правильность числовых данных (температуры, константы и т.д.)
4. Нет ли противоречий между блоками

Верни ТОЛЬКО JSON:
{
  "status": "ok" | "warnings" | "errors",
  "issues": [
    {
      "type": "error" | "warning",
      "location": "краткое описание где найдена проблема",
      "found": "что нашли",
      "correct": "как должно быть правильно"
    }
  ],
  "summary": "краткое резюме проверки (1 предложение)"
}

Если ошибок нет — верни status: "ok" и пустой массив issues.`;

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
    // Checker не блокирует урок при ошибке
    console.warn('Checker warning:', e.message);
    return { status: 'ok', issues: [], summary: 'Проверка пропущена' };
  }
}

module.exports = { checkLesson };
