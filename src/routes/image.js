const express = require('express');
const router = express.Router();
const { resolveSceneImage } = require('../agents/sceneImage');

/**
 * GET /api/image/search?q=...&concept=...
 * Löser EN bild on-demand: Google Custom Search (max 3 kandidater, Claude
 * Vision-relevanskontroll) → DALL-E 3-reserv → null. Anropas av klienten
 * progressivt, en scen i taget, EFTER att lektionen redan visas — se
 * src/agents/sceneImage.js för hela kedjan.
 */
router.get('/search', async (req, res) => {
  const { q, concept } = req.query;
  if (!q) return res.status(400).json({ error: 'q krävs' });

  try {
    const result = await resolveSceneImage({ query: q, concept });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: 'Kunde inte söka bild', details: error.message });
  }
});

module.exports = router;
