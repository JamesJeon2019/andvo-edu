const express = require('express');
const router = express.Router();

/**
 * POST /api/image/validate
 * Kontrollerar att en lärarinklistrad länk faktiskt pekar på en bild, genom
 * att göra en HEAD-förfrågan och läsa Content-Type — utan att ladda ner
 * hela filen.
 */
router.post('/validate', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.json({ valid: false });

  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return res.json({ valid: false });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.json({ valid: false });
  }

  try {
    const response = await fetch(parsed.toString(), { method: 'HEAD' });
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    res.json({ valid: response.ok && contentType.startsWith('image/') });
  } catch (e) {
    res.json({ valid: false });
  }
});

module.exports = router;
