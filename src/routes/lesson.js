const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { planLesson, planLessonFromMaterial } = require('../agents/planner');
const { extractTextbookMaterial } = require('../agents/textbookReader');
const { writeLesson, writeBlock, illustrateLesson, illustrateBlockScenes, countIllustrableScenes } = require('../agents/writer');
const { checkLesson, checkMaterialFaithfulness } = require('../agents/checker');
const { generateSVG } = require('../agents/illustrator');
const { searchYoutubeVideos, getCaptionTracks } = require('../agents/youtubeSearch');
const { getLesson, saveLesson, archiveLesson, listLessons } = require('../db/lessonStore');
const { scoped } = require('../utils/logger');

// In-memory förloppsindikator per lektions-ID, för /status-polling under generering
// (avsiktligt kortlivad — rensas aldrig mot databasen, se handoff.md)
const progress = new Map();

const STATUS_MESSAGES = {
  plan: 'Skapar lektionsplan...',
  content: 'Genererar innehåll...',
  check: 'Granskar fakta...',
  done: 'Lektion klar!'
};

const MAX_MATERIAL_PAGES = 8;

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
  const log = scoped(lessonId.slice(0, 8));
  log.log(`\n📚 Genererar lektion: "${topic}" | ${subject} | ${level}`);

  try {
    // ── Steg 1: Planner ─────────────────────────────
    log.log('  🗓  Planner: skapar plan...');
    const plan = await planLesson({ topic, subject, level, duration, language });
    log.log(`  ✅ Plan klar: ${plan.blocks.length} block`);

    // ── Steg 2: Writer (text) ───────────────────────
    setProgress(lessonId, { step: 'content' });
    log.log('  ✍️  Writer: genererar innehåll...');
    const written = await writeLesson({ plan, level, language });
    log.log('  ✅ Innehåll klart');

    // ── Steg 3: Illustrator (SVG per scen) ──────────
    const svgTotal = countIllustrableScenes(written.blocks);
    setProgress(lessonId, { step: 'svg', svg_done: 0, svg_total: svgTotal });
    log.log(`  🎨 Illustrator: skapar ${svgTotal} illustrationer...`);
    await illustrateLesson(written.blocks, subject, (done, total) => {
      setProgress(lessonId, { step: 'svg', svg_done: done, svg_total: total });
    });
    log.log('  ✅ Illustrationer klara');

    // ── Steg 4: Checker ─────────────────────────────
    setProgress(lessonId, { step: 'check' });
    log.log('  🔍 Checker: kontrollerar fakta...');
    const checkResult = await checkLesson({ lesson: written, subject });
    log.log(`  ✅ Kontroll: ${checkResult.status} — ${checkResult.summary}`);

    // ── Sätter ihop den färdiga lektionen ────────────────────
    const finalLesson = {
      id: lessonId,
      ...written,
      check: checkResult,
      createdAt: new Date().toISOString()
    };
    await saveLesson(lessonId, finalLesson);

    setProgress(lessonId, { step: 'done', svg_done: svgTotal, svg_total: svgTotal });
    log.log(`  🎉 Lektion klar: ID ${lessonId}\n`);

  } catch (error) {
    log.error('❌ Fel vid generering:', error.stack || error.message);
    setProgress(lessonId, { error: 'Fel vid generering av lektion' });
  }
}

/**
 * POST /api/lesson/extract-material
 * Läser av lärarens uppladdade läroboksfoton med Claude Vision och
 * returnerar den transkriberade texten direkt i svaret. Ett enda
 * Vision-anrop är snabbt nog för att köras synkront utan progress-polling.
 * Läraren får läsa igenom och rätta texten (formler, kemiska index och
 * diagram kan bli fel) innan hela lektionen genereras via
 * /generate-from-material.
 */
router.post('/extract-material', async (req, res) => {
  const { images, language } = req.body;

  if (!Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: 'Minst ett foto av en läroboksida krävs' });
  }
  if (images.length > MAX_MATERIAL_PAGES) {
    return res.status(400).json({ error: `Max ${MAX_MATERIAL_PAGES} sidor åt gången` });
  }

  const log = scoped(uuidv4().slice(0, 8));
  log.log('📄 Läser läroboksfoton...');

  try {
    const { title, text } = await extractTextbookMaterial(images, language || 'sv');
    log.log('✅ Läroboksfoton avlästa');
    res.json({ success: true, title, text });
  } catch (error) {
    log.error('❌ Fel vid läsning av läroboksfoton:', error.stack || error.message);
    res.status(500).json({ error: 'Kunde inte läsa av läroboksfotona, försök igen' });
  }
});

/**
 * POST /api/lesson/generate-from-material
 * "Skapa från lärobok" — läraren har redan fått materialet avläst (och ev.
 * rättat) via /extract-material. Tar emot den färdiga texten direkt, utan
 * något nytt Vision-anrop, och genererar hela lektionen strikt utifrån
 * den. Svarar direkt med ett lessonId, precis som /generate.
 */
router.post('/generate-from-material', (req, res) => {
  const { material, subject, level, duration, language } = req.body;

  if (!subject || !level) {
    return res.status(400).json({ error: 'subject och level krävs' });
  }
  if (!material || !material.text || !material.text.trim()) {
    return res.status(400).json({ error: 'Inläst material krävs' });
  }

  const lessonId = uuidv4();
  setProgress(lessonId, { step: 'plan', svg_done: 0, svg_total: 0, error: null });

  res.json({ success: true, lessonId });

  runGenerationFromMaterial(lessonId, {
    material: material.text,
    subject,
    level,
    duration: duration || 60,
    language: language || 'sv'
  });
});

async function runGenerationFromMaterial(lessonId, { material, subject, level, duration, language }) {
  const log = scoped(lessonId.slice(0, 8));
  log.log(`\n📖 Genererar lektion från lärobok | ${subject} | ${level}`);

  try {
    // ── Steg 1: Planner (endast från materialet) ────
    log.log('  🗓  Planner: skapar plan från material...');
    const plan = await planLessonFromMaterial({ material, subject, level, duration, language });
    log.log(`  ✅ Plan klar: ${plan.blocks.length} block`);

    // ── Steg 2: Writer (text) ───────────────────────
    setProgress(lessonId, { step: 'content' });
    log.log('  ✍️  Writer: genererar innehåll...');
    const written = await writeLesson({ plan, level, language });
    log.log('  ✅ Innehåll klart');

    // ── Steg 3: Illustrator (SVG per scen) ──────────
    const svgTotal = countIllustrableScenes(written.blocks);
    setProgress(lessonId, { step: 'svg', svg_done: 0, svg_total: svgTotal });
    log.log(`  🎨 Illustrator: skapar ${svgTotal} illustrationer...`);
    await illustrateLesson(written.blocks, subject, (done, total) => {
      setProgress(lessonId, { step: 'svg', svg_done: done, svg_total: total });
    });
    log.log('  ✅ Illustrationer klara');

    // ── Steg 4: Checker ─────────────────────────────
    setProgress(lessonId, { step: 'check' });
    log.log('  🔍 Checker: kontrollerar fakta...');
    const checkResult = await checkLesson({ lesson: written, subject });
    log.log(`  ✅ Kontroll: ${checkResult.status} — ${checkResult.summary}`);

    // ── Steg 5: Källtrohetskontroll (endast lärobok-läget) ──
    log.log('  📐 Kontrollerar källtrohet mot materialet...');
    const faithfulnessResult = await checkMaterialFaithfulness({ lesson: written, material });
    log.log(`  ✅ Källtrohet: ${faithfulnessResult.status} — ${faithfulnessResult.summary}`);

    // ── Sätter ihop den färdiga lektionen ────────────────────
    const finalLesson = {
      id: lessonId,
      ...written,
      check: checkResult,
      faithfulnessCheck: faithfulnessResult,
      source: 'material',
      createdAt: new Date().toISOString()
    };
    await saveLesson(lessonId, finalLesson);

    setProgress(lessonId, { step: 'done', svg_done: svgTotal, svg_total: svgTotal });
    log.log(`  🎉 Lektion klar: ID ${lessonId}\n`);

  } catch (error) {
    log.error('❌ Fel vid generering från lärobok:', error.stack || error.message);
    setProgress(lessonId, { error: 'Fel vid generering av lektion från lärobok' });
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
router.get('/:id', async (req, res) => {
  const lesson = await getLesson(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lektionen hittades inte' });
  res.json({ success: true, lesson });
});

/**
 * PUT /api/lesson/:id/block/:blockId
 * Uppdatera ett block (läraren redigerar)
 */
router.put('/:id/block/:blockId', async (req, res) => {
  const lesson = await getLesson(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lektionen hittades inte' });

  const blockId = parseInt(req.params.blockId);
  const blockIndex = lesson.blocks.findIndex(b => b.id === blockId);
  if (blockIndex === -1) return res.status(404).json({ error: 'Blocket hittades inte' });

  lesson.blocks[blockIndex] = { ...lesson.blocks[blockIndex], ...req.body };
  await saveLesson(lesson.id, lesson);

  res.json({ success: true, block: lesson.blocks[blockIndex] });
});

/**
 * DELETE /api/lesson/:id/block/:blockId
 * Ta bort ett block
 */
router.delete('/:id/block/:blockId', async (req, res) => {
  const lesson = await getLesson(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lektionen hittades inte' });

  const blockId = parseInt(req.params.blockId);
  lesson.blocks = lesson.blocks.filter(b => b.id !== blockId);
  await saveLesson(lesson.id, lesson);

  res.json({ success: true, blocksRemaining: lesson.blocks.length });
});

/**
 * PUT /api/lesson/:id/block/:blockId/toggle
 * Dölj/visa ett block (tar inte bort det)
 */
router.put('/:id/block/:blockId/toggle', async (req, res) => {
  const lesson = await getLesson(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lektionen hittades inte' });

  const blockId = parseInt(req.params.blockId);
  const block = lesson.blocks.find(b => b.id === blockId);
  if (!block) return res.status(404).json({ error: 'Blocket hittades inte' });

  block.visible = !block.visible;
  await saveLesson(lesson.id, lesson);

  res.json({ success: true, blockId, visible: block.visible });
});

/**
 * PUT /api/lesson/:id/block/:blockId/youtube
 * Spara en YouTube-länk (försvinner inte vid navigering)
 */
router.put('/:id/block/:blockId/youtube', async (req, res) => {
  const lesson = await getLesson(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lektionen hittades inte' });

  const blockId = parseInt(req.params.blockId);
  const block = lesson.blocks.find(b => b.id === blockId);
  if (!block) return res.status(404).json({ error: 'Blocket hittades inte' });

  block.content = block.content || {};
  block.content.youtube_url = req.body.url;
  block.youtube_url = req.body.url;
  await saveLesson(lesson.id, lesson);

  res.json({ success: true, youtube_url: req.body.url });
});

/**
 * POST /api/lesson/:id/block/:blockId/youtube-search
 * Söker YouTube efter videoförslag (max 3) för läraren att välja mellan.
 * Kan anropas både automatiskt (standardfråga vid blockets första visning)
 * och manuellt när läraren skriver egna sökord ("Sök igen").
 */
router.post('/:id/block/:blockId/youtube-search', async (req, res) => {
  const lesson = await getLesson(req.params.id);
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
  const lesson = await getLesson(req.params.id);
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
    await saveLesson(lesson.id, lesson);

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
  const lesson = await getLesson(req.params.id);
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
    await saveLesson(lesson.id, lesson);

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
router.put('/:id/block/:blockId/scene/:sceneIndex/image', async (req, res) => {
  const lesson = await getLesson(req.params.id);
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
  await saveLesson(lesson.id, lesson);

  res.json({ success: true });
});

/**
 * PUT /api/lesson/:id/blocks/reorder
 * Ändra ordningen på blocken
 */
router.put('/:id/blocks/reorder', async (req, res) => {
  const lesson = await getLesson(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lektionen hittades inte' });

  const { order } = req.body; // array med ID:n i ny ordning
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order måste vara en array av ID:n' });

  const reordered = order.map(id => lesson.blocks.find(b => b.id === id)).filter(Boolean);
  lesson.blocks = reordered;
  await saveLesson(lesson.id, lesson);

  res.json({ success: true, blocks: lesson.blocks });
});

/**
 * GET /api/lesson
 * Lista alla lektioner (för läraren) — lättviktig sammanfattning utan
 * fullständig data, se listLessons i src/db/lessonStore.js.
 */
router.get('/', async (req, res) => {
  const list = await listLessons();
  res.json({ success: true, lessons: list });
});

/**
 * PUT /api/lesson/:id/archive
 * Arkiverar en lektion (status = 'archived') utan att radera den.
 */
router.put('/:id/archive', async (req, res) => {
  await archiveLesson(req.params.id);
  res.json({ success: true });
});

module.exports = router;
