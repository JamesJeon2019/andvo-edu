const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { planLesson } = require('../agents/planner');
const { writeLesson, writeBlock } = require('../agents/writer');
const { checkLesson } = require('../agents/checker');
const { pickVisual, verifyVisualMatch, summarizeConcept } = require('../agents/visualPicker');
const { getCaptionTracks } = require('../agents/youtubeSearch');

// In-memory lagring av lektioner (byt till PostgreSQL senare)
const lessons = new Map();

/**
 * POST /api/lesson/generate
 * Huvudendpoint — genererar en komplett lektion
 */
router.post('/generate', async (req, res) => {
  const { topic, subject, level, duration, language } = req.body;

  if (!topic || !subject || !level) {
    return res.status(400).json({ error: 'topic, subject och level krävs' });
  }

  console.log(`\n📚 Genererar lektion: "${topic}" | ${subject} | ${level}`);

  try {
    // ── Steg 1: Planner ─────────────────────────────
    console.log('  🗓  Planner: skapar plan...');
    const plan = await planLesson({
      topic,
      subject,
      level,
      duration: duration || 60,
      language: language || 'sv'
    });
    console.log(`  ✅ Plan klar: ${plan.blocks.length} block`);

    // ── Steg 2: Writer ──────────────────────────────
    console.log('  ✍️  Writer: genererar innehåll...');
    const written = await writeLesson({
      plan,
      level,
      language: language || 'sv'
    });
    console.log('  ✅ Innehåll klart');

    // ── Steg 3: Checker ─────────────────────────────
    console.log('  🔍 Checker: kontrollerar fakta...');
    const checkResult = await checkLesson({
      lesson: written,
      subject
    });
    console.log(`  ✅ Kontroll: ${checkResult.status} — ${checkResult.summary}`);

    // ── Sätter ihop den färdiga lektionen ────────────────────
    const lessonId = uuidv4();
    const finalLesson = {
      id: lessonId,
      ...written,
      check: checkResult,
      createdAt: new Date().toISOString()
    };

    // Sparar i minnet
    lessons.set(lessonId, finalLesson);

    console.log(`  🎉 Lektion klar: ID ${lessonId}\n`);

    res.json({
      success: true,
      lessonId,
      lesson: finalLesson
    });

  } catch (error) {
    console.error('❌ Fel vid generering:', error.message);
    res.status(500).json({
      error: 'Fel vid generering av lektion',
      details: error.message
    });
  }
});

/**
 * GET /api/lesson/:id
 * Hämta en lektion via ID
 */
router.get('/:id', (req, res) => {
  const lesson = lessons.get(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lektionen hittades inte' });
  res.json({ success: true, lesson });
});

/**
 * PUT /api/lesson/:id/block/:blockId
 * Uppdatera ett block (läraren redigerar)
 */
router.put('/:id/block/:blockId', (req, res) => {
  const lesson = lessons.get(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lektionen hittades inte' });

  const blockId = parseInt(req.params.blockId);
  const blockIndex = lesson.blocks.findIndex(b => b.id === blockId);
  if (blockIndex === -1) return res.status(404).json({ error: 'Blocket hittades inte' });

  lesson.blocks[blockIndex] = { ...lesson.blocks[blockIndex], ...req.body };
  lessons.set(lesson.id, lesson);

  res.json({ success: true, block: lesson.blocks[blockIndex] });
});

/**
 * DELETE /api/lesson/:id/block/:blockId
 * Ta bort ett block
 */
router.delete('/:id/block/:blockId', (req, res) => {
  const lesson = lessons.get(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lektionen hittades inte' });

  const blockId = parseInt(req.params.blockId);
  lesson.blocks = lesson.blocks.filter(b => b.id !== blockId);
  lessons.set(lesson.id, lesson);

  res.json({ success: true, blocksRemaining: lesson.blocks.length });
});

/**
 * PUT /api/lesson/:id/block/:blockId/toggle
 * Dölj/visa ett block (tar inte bort det)
 */
router.put('/:id/block/:blockId/toggle', (req, res) => {
  const lesson = lessons.get(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lektionen hittades inte' });

  const blockId = parseInt(req.params.blockId);
  const block = lesson.blocks.find(b => b.id === blockId);
  if (!block) return res.status(404).json({ error: 'Blocket hittades inte' });

  block.visible = !block.visible;
  lessons.set(lesson.id, lesson);

  res.json({ success: true, blockId, visible: block.visible });
});

/**
 * PUT /api/lesson/:id/block/:blockId/youtube
 * Spara en YouTube-länk (försvinner inte vid navigering)
 */
router.put('/:id/block/:blockId/youtube', (req, res) => {
  const lesson = lessons.get(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lektionen hittades inte' });

  const blockId = parseInt(req.params.blockId);
  const block = lesson.blocks.find(b => b.id === blockId);
  if (!block) return res.status(404).json({ error: 'Blocket hittades inte' });

  block.content = block.content || {};
  block.content.youtube_url = req.body.url;
  block.youtube_url = req.body.url;
  lessons.set(lesson.id, lesson);

  res.json({ success: true, youtube_url: req.body.url });
});

/**
 * GET /api/lesson/youtube-captions/:videoId
 * Hämtar tillgängliga undertextspår för en vald video (best-effort — se
 * kommentar i src/agents/youtubeSearch.js om API-nyckelns begränsningar).
 */
router.get('/youtube-captions/:videoId', async (req, res) => {
  const tracks = await getCaptionTracks(req.params.videoId);
  res.json({ success: true, tracks });
});

/**
 * POST /api/lesson/:id/block/:blockId/rewrite
 * AI skriver om ett block enligt lärarens instruktion
 */
router.post('/:id/block/:blockId/rewrite', async (req, res) => {
  const lesson = lessons.get(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lektionen hittades inte' });

  const blockId = parseInt(req.params.blockId);
  const blockIndex = lesson.blocks.findIndex(b => b.id === blockId);
  if (blockIndex === -1) return res.status(404).json({ error: 'Blocket hittades inte' });

  const { instruction } = req.body;
  if (!instruction) return res.status(400).json({ error: 'instruction krävs' });

  try {
    // Ändrar blockets description enligt lärarens instruktion
    const block = lesson.blocks[blockIndex];
    const modifiedBlock = {
      ...block,
      description: `${block.description}. LÄRARENS INSTRUKTION: ${instruction}`
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
    res.status(500).json({ error: 'Fel vid omskrivning av block', details: error.message });
  }
});

/**
 * PUT /api/lesson/:id/blocks/reorder
 * Ändra ordningen på blocken
 */
router.put('/:id/blocks/reorder', (req, res) => {
  const lesson = lessons.get(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lektionen hittades inte' });

  const { order } = req.body; // array med ID:n i ny ordning
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order måste vara en array av ID:n' });

  const reordered = order.map(id => lesson.blocks.find(b => b.id === id)).filter(Boolean);
  lesson.blocks = reordered;
  lessons.set(lesson.id, lesson);

  res.json({ success: true, blocks: lesson.blocks });
});

/**
 * POST /api/lesson/visual-decision
 * Claude väljer Wikimedia-sökfråga för en scen baserat på voice_text.
 * previous_query (valfri) skickas med vid omförsök efter en misslyckad
 * relevanskontroll, så Claude föreslår en genuint annan fråga.
 */
router.post('/visual-decision', async (req, res) => {
  const { voice_text, previous_query } = req.body;
  if (!voice_text) return res.status(400).json({ error: 'voice_text krävs' });

  try {
    const decision = await pickVisual({ voice_text, previous_query });
    res.json({ success: true, decision });
  } catch (error) {
    res.status(500).json({ error: 'Kunde inte avgöra visualisering', details: error.message });
  }
});

/**
 * POST /api/lesson/visual-verify
 * Claude kontrollerar om en Wikimedia-bildtitel faktiskt visar det vetenskapliga
 * konceptet i scenens voice_text på ett sätt som passar årskurs 7-9 — skydd mot
 * att Commons nyckelordssökning ger en irrelevant, för avancerad eller felaktig bild.
 */
router.post('/visual-verify', async (req, res) => {
  const { image_title, voice_text } = req.body;
  if (!image_title || !voice_text) return res.status(400).json({ error: 'image_title och voice_text krävs' });

  try {
    const match = await verifyVisualMatch({ image_title, voice_text });
    res.json({ success: true, match });
  } catch (error) {
    res.status(500).json({ error: 'Kunde inte verifiera bilden', details: error.message });
  }
});

/**
 * POST /api/lesson/visual-summary
 * Sista utväg när ingen Wikimedia-bild klarade relevanskontrollen efter alla
 * omförsök — en kort svensk sammanfattning att visa som text i en färgad
 * platshållarruta, så eleven ser något relevant i stället för en tom ruta.
 */
router.post('/visual-summary', async (req, res) => {
  const { voice_text } = req.body;
  if (!voice_text) return res.status(400).json({ error: 'voice_text krävs' });

  try {
    const summary = await summarizeConcept({ voice_text });
    res.json({ success: true, summary });
  } catch (error) {
    res.status(500).json({ error: 'Kunde inte sammanfatta konceptet', details: error.message });
  }
});

/**
 * GET /api/lesson
 * Lista alla lektioner (för läraren)
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
