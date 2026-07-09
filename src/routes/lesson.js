const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { planLesson } = require('../agents/planner');
const { writeLesson, writeBlock, illustrateLesson, illustrateBlockScenes, countIllustrableScenes } = require('../agents/writer');
const { checkLesson } = require('../agents/checker');
const { generateSVG } = require('../agents/illustrator');
const { searchYoutubeVideos, getCaptionTracks } = require('../agents/youtubeSearch');

// In-memory lagring av lektioner (byt till PostgreSQL senare)
const lessons = new Map();

// In-memory förloppsindikator per lektions-ID, för /status-polling under generering
const progress = new Map();

const STATUS_MESSAGES = {
  plan: 'Skapar lektionsplan...',
  content: 'Genererar innehåll...',
  check: 'Granskar fakta...',
  done: 'Lektion klar!'
};

function setProgress(lessonId, patch) {
  const current = progress.get(lessonId) || { step: 'plan', svg_done: 0, svg_total: 0, error: null };
  progress.set(lessonId, { ...current, ...patch });
}

/**
 * POST /api/lesson/generate
 * Huvudendpoint — startar genereringen av en komplett lektion. Svarar direkt
 * med ett lessonId; själva genereringen sker asynkront i bakgrunden och
 * förloppet kan följas via GET /:id/status.
 */
router.post('/generate', (req, res) => {
  const { topic, subject, level, duration, language } = req.body;

  if (!topic || !subject || !level) {
    return res.status(400).json({ error: 'topic, subject och level krävs' });
  }

  const lessonId = uuidv4();
  setProgress(lessonId, { step: 'plan', svg_done: 0, svg_total: 0, error: null });

  res.json({ success: true, lessonId });

  runGeneration(lessonId, {
    topic,
    subject,
    level,
    duration: duration || 60,
    language: language || 'sv'
  });
});

async function runGeneration(lessonId, { topic, subject, level, duration, language }) {
  console.log(`\n📚 Genererar lektion: "${topic}" | ${subject} | ${level}`);

  try {
    // ── Steg 1: Planner ─────────────────────────────
    console.log('  🗓  Planner: skapar plan...');
    const plan = await planLesson({ topic, subject, level, duration, language });
    console.log(`  ✅ Plan klar: ${plan.blocks.length} block`);

    // ── Steg 2: Writer (text) ───────────────────────
    setProgress(lessonId, { step: 'content' });
    console.log('  ✍️  Writer: genererar innehåll...');
    const written = await writeLesson({ plan, level, language });
    console.log('  ✅ Innehåll klart');

    // ── Steg 3: Illustrator (SVG per scen) ──────────
    const svgTotal = countIllustrableScenes(written.blocks);
    setProgress(lessonId, { step: 'svg', svg_done: 0, svg_total: svgTotal });
    console.log(`  🎨 Illustrator: skapar ${svgTotal} illustrationer...`);
    await illustrateLesson(written.blocks, subject, (done, total) => {
      setProgress(lessonId, { step: 'svg', svg_done: done, svg_total: total });
    });
    console.log('  ✅ Illustrationer klara');

    // ── Steg 4: Checker ─────────────────────────────
    setProgress(lessonId, { step: 'check' });
    console.log('  🔍 Checker: kontrollerar fakta...');
    const checkResult = await checkLesson({ lesson: written, subject });
    console.log(`  ✅ Kontroll: ${checkResult.status} — ${checkResult.summary}`);

    // ── Sätter ihop den färdiga lektionen ────────────────────
    const finalLesson = {
      id: lessonId,
      ...written,
      check: checkResult,
      createdAt: new Date().toISOString()
    };
    lessons.set(lessonId, finalLesson);

    setProgress(lessonId, { step: 'done', svg_done: svgTotal, svg_total: svgTotal });
    console.log(`  🎉 Lektion klar: ID ${lessonId}\n`);

  } catch (error) {
    console.error('❌ Fel vid generering:', error.message);
    setProgress(lessonId, { error: 'Fel vid generering av lektion' });
  }
}

/**
 * GET /api/lesson/:id/status
 * Förloppsindikator som pollas av frontend under generering.
 */
router.get('/:id/status', (req, res) => {
  const p = progress.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Okänt lektions-ID' });

  const message = p.step === 'svg'
    ? `Skapar illustrationer... (${p.svg_done} av ${p.svg_total})`
    : STATUS_MESSAGES[p.step] || '';

  res.json({
    step: p.step,
    svg_done: p.svg_done,
    svg_total: p.svg_total,
    message,
    error: p.error
  });
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
 * POST /api/lesson/:id/block/:blockId/youtube-search
 * Söker YouTube efter videoförslag (max 3) för läraren att välja mellan.
 * Kan anropas både automatiskt (standardfråga vid blockets första visning)
 * och manuellt när läraren skriver egna sökord ("Sök igen").
 */
router.post('/:id/block/:blockId/youtube-search', async (req, res) => {
  const lesson = lessons.get(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lektionen hittades inte' });

  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'query krävs' });

  try {
    const videos = await searchYoutubeVideos(query);
    res.json({ success: true, videos });
  } catch (error) {
    if (error.code === 'NO_API_KEY') {
      return res.status(503).json({ error: 'YouTube-sökning är inte konfigurerad', code: 'NO_API_KEY' });
    }
    res.status(500).json({ error: 'Kunde inte söka på YouTube', details: error.message });
  }
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
    await illustrateBlockScenes(rewritten, lesson.subject);

    lesson.blocks[blockIndex] = { ...rewritten, id: blockId };
    lessons.set(lesson.id, lesson);

    res.json({ success: true, block: lesson.blocks[blockIndex] });
  } catch (error) {
    res.status(500).json({ error: 'Fel vid omskrivning av block', details: error.message });
  }
});

/**
 * POST /api/lesson/:id/block/:blockId/regenerate-svg
 * Ritar om illustrationen för en enskild scen — antingen från grunden
 * ("Rita om") eller enligt lärarens skrivna instruktion ("Ge instruktion").
 * Body: { sceneIndex: 0, instruction: "valfri instruktion på svenska" }
 */
router.post('/:id/block/:blockId/regenerate-svg', async (req, res) => {
  const lesson = lessons.get(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lektionen hittades inte' });

  const blockId = parseInt(req.params.blockId);
  const block = lesson.blocks.find(b => b.id === blockId);
  if (!block) return res.status(404).json({ error: 'Blocket hittades inte' });

  const { instruction, sceneIndex } = req.body;
  const scenes = block.content && block.content.scenes;
  const idx = Number.isInteger(sceneIndex) ? sceneIndex : 0;
  const scene = Array.isArray(scenes) ? scenes[idx] : null;
  if (!scene) return res.status(404).json({ error: 'Scenen hittades inte' });

  try {
    const svg = await generateSVG(scene.voice_text, block.type, lesson.subject, instruction || null);
    if (!svg) throw new Error('Ogiltig SVG genererades');

    scene.svg_content = svg;
    scene.custom_image = null;
    scene.custom_image_url = null;
    lessons.set(lesson.id, lesson);

    res.json({ svg_content: svg });
  } catch (error) {
    const message = instruction
      ? 'Kunde inte uppdatera illustration, försök igen'
      : 'Kunde inte skapa ny illustration, försök igen';
    res.status(500).json({ error: message });
  }
});

/**
 * PUT /api/lesson/:id/block/:blockId/scene/:sceneIndex/image
 * Sparar lärarens egen bild för en scen (uppladdad fil eller inklistrad
 * länk) så att den inte försvinner vid omladdning. custom_image och
 * custom_image_url är ömsesidigt uteslutande — sätts den ena nollställs
 * den andra. Body: { custom_image: string|null, custom_image_url: string|null }
 */
router.put('/:id/block/:blockId/scene/:sceneIndex/image', (req, res) => {
  const lesson = lessons.get(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lektionen hittades inte' });

  const blockId = parseInt(req.params.blockId);
  const block = lesson.blocks.find(b => b.id === blockId);
  if (!block) return res.status(404).json({ error: 'Blocket hittades inte' });

  const sceneIndex = parseInt(req.params.sceneIndex);
  const scenes = block.content && block.content.scenes;
  const scene = Array.isArray(scenes) ? scenes[sceneIndex] : null;
  if (!scene) return res.status(404).json({ error: 'Scenen hittades inte' });

  const { custom_image, custom_image_url } = req.body;
  scene.custom_image = custom_image || null;
  scene.custom_image_url = scene.custom_image ? null : (custom_image_url || null);
  lessons.set(lesson.id, lesson);

  res.json({ success: true });
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
