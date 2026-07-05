const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { planLesson } = require('../agents/planner');
const { writeLesson, writeBlock } = require('../agents/writer');
const { checkLesson } = require('../agents/checker');

// In-memory хранилище уроков (замените на PostgreSQL позже)
const lessons = new Map();

/**
 * POST /api/lesson/generate
 * Главный эндпоинт — генерирует полный урок
 */
router.post('/generate', async (req, res) => {
  const { topic, subject, level, duration, language } = req.body;

  if (!topic || !subject || !level) {
    return res.status(400).json({ error: 'Нужны topic, subject и level' });
  }

  console.log(`\n📚 Генерирую урок: "${topic}" | ${subject} | ${level}`);

  try {
    // ── Шаг 1: Planner ─────────────────────────────
    console.log('  🗓  Planner: составляю план...');
    const plan = await planLesson({
      topic,
      subject,
      level,
      duration: duration || 60,
      language: language || 'sv'
    });
    console.log(`  ✅ План готов: ${plan.blocks.length} блоков`);

    // ── Шаг 2: Writer ──────────────────────────────
    console.log('  ✍️  Writer: генерирую контент...');
    const written = await writeLesson({
      plan,
      level,
      language: language || 'sv'
    });
    console.log('  ✅ Контент готов');

    // ── Шаг 3: Checker ─────────────────────────────
    console.log('  🔍 Checker: проверяю факты...');
    const checkResult = await checkLesson({
      lesson: written,
      subject
    });
    console.log(`  ✅ Проверка: ${checkResult.status} — ${checkResult.summary}`);

    // ── Собираем финальный урок ────────────────────
    const lessonId = uuidv4();
    const finalLesson = {
      id: lessonId,
      ...written,
      check: checkResult,
      createdAt: new Date().toISOString()
    };

    // Сохраняем в памяти
    lessons.set(lessonId, finalLesson);

    console.log(`  🎉 Урок готов: ID ${lessonId}\n`);

    res.json({
      success: true,
      lessonId,
      lesson: finalLesson
    });

  } catch (error) {
    console.error('❌ Ошибка генерации:', error.message);
    res.status(500).json({
      error: 'Ошибка генерации урока',
      details: error.message
    });
  }
});

/**
 * GET /api/lesson/:id
 * Получить урок по ID
 */
router.get('/:id', (req, res) => {
  const lesson = lessons.get(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Урок не найден' });
  res.json({ success: true, lesson });
});

/**
 * PUT /api/lesson/:id/block/:blockId
 * Обновить блок (учитель редактирует)
 */
router.put('/:id/block/:blockId', (req, res) => {
  const lesson = lessons.get(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Урок не найден' });

  const blockId = parseInt(req.params.blockId);
  const blockIndex = lesson.blocks.findIndex(b => b.id === blockId);
  if (blockIndex === -1) return res.status(404).json({ error: 'Блок не найден' });

  lesson.blocks[blockIndex] = { ...lesson.blocks[blockIndex], ...req.body };
  lessons.set(lesson.id, lesson);

  res.json({ success: true, block: lesson.blocks[blockIndex] });
});

/**
 * DELETE /api/lesson/:id/block/:blockId
 * Удалить блок
 */
router.delete('/:id/block/:blockId', (req, res) => {
  const lesson = lessons.get(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Урок не найден' });

  const blockId = parseInt(req.params.blockId);
  lesson.blocks = lesson.blocks.filter(b => b.id !== blockId);
  lessons.set(lesson.id, lesson);

  res.json({ success: true, blocksRemaining: lesson.blocks.length });
});

/**
 * PUT /api/lesson/:id/block/:blockId/toggle
 * Скрыть/показать блок (не удалять)
 */
router.put('/:id/block/:blockId/toggle', (req, res) => {
  const lesson = lessons.get(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Урок не найден' });

  const blockId = parseInt(req.params.blockId);
  const block = lesson.blocks.find(b => b.id === blockId);
  if (!block) return res.status(404).json({ error: 'Блок не найден' });

  block.visible = !block.visible;
  lessons.set(lesson.id, lesson);

  res.json({ success: true, blockId, visible: block.visible });
});

/**
 * PUT /api/lesson/:id/block/:blockId/youtube
 * Сохранить YouTube ссылку (не теряется при навигации)
 */
router.put('/:id/block/:blockId/youtube', (req, res) => {
  const lesson = lessons.get(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Урок не найден' });

  const blockId = parseInt(req.params.blockId);
  const block = lesson.blocks.find(b => b.id === blockId);
  if (!block) return res.status(404).json({ error: 'Блок не найден' });

  block.content = block.content || {};
  block.content.youtube_url = req.body.url;
  block.youtube_url = req.body.url;
  lessons.set(lesson.id, lesson);

  res.json({ success: true, youtube_url: req.body.url });
});

/**
 * POST /api/lesson/:id/block/:blockId/rewrite
 * AI переписывает один блок по запросу учителя
 */
router.post('/:id/block/:blockId/rewrite', async (req, res) => {
  const lesson = lessons.get(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Урок не найден' });

  const blockId = parseInt(req.params.blockId);
  const blockIndex = lesson.blocks.findIndex(b => b.id === blockId);
  if (blockIndex === -1) return res.status(404).json({ error: 'Блок не найден' });

  const { instruction } = req.body;
  if (!instruction) return res.status(400).json({ error: 'Нужен instruction' });

  try {
    // Модифицируем description блока по запросу учителя
    const block = lesson.blocks[blockIndex];
    const modifiedBlock = {
      ...block,
      description: `${block.description}. ИНСТРУКЦИЯ УЧИТЕЛЯ: ${instruction}`
    };

    const rewritten = await writeBlock({
      block: modifiedBlock,
      lessonContext: lesson,
      level: lesson.level,
      language: lesson.language
    });

    lesson.blocks[blockIndex] = { ...rewritten, id: blockId };
    lessons.set(lesson.id, lesson);

    res.json({ success: true, block: lesson.blocks[blockIndex] });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка переработки блока', details: error.message });
  }
});

/**
 * PUT /api/lesson/:id/blocks/reorder
 * Изменить порядок блоков
 */
router.put('/:id/blocks/reorder', (req, res) => {
  const lesson = lessons.get(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Урок не найден' });

  const { order } = req.body; // массив ID в новом порядке
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order должен быть массивом ID' });

  const reordered = order.map(id => lesson.blocks.find(b => b.id === id)).filter(Boolean);
  lesson.blocks = reordered;
  lessons.set(lesson.id, lesson);

  res.json({ success: true, blocks: lesson.blocks });
});

/**
 * GET /api/lesson
 * Список всех уроков (для учителя)
 */
router.get('/', (req, res) => {
  const list = Array.from(lessons.values()).map(l => ({
    id: l.id,
    title: l.title,
    subject: l.subject,
    level: l.level,
    duration: l.duration,
    blocksCount: l.blocks.length,
    createdAt: l.createdAt
  }));
  res.json({ success: true, lessons: list });
});

module.exports = router;
