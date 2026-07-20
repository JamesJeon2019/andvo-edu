const express = require('express');
const router = express.Router();

const FETCH_TIMEOUT_MS = 5000;

// Många bildsajter (Google Images, stockfoto-sajter, de flesta CDN:er)
// blockerar förfrågningar utan en webbläsarliknande User-Agent och svarar
// 403/HTML även för länkar som faktiskt pekar på en fungerande bild.
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function isImageContentType(response) {
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  return response.ok && contentType.startsWith('image/');
}

// redirect: 'follow' är fetch-standardbeteendet, men sätts explicit här så
// att 3xx-omdirigeringar (vanligt hos bildhotell och CDN:er) garanterat
// följs oavsett vad som körs mot.
async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, redirect: 'follow', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST /api/image/validate
 * Kontrollerar att en lärarinklistrad länk faktiskt pekar på en bild.
 * Provar först en HEAD-förfrågan (snabbast, laddar inte ner något). Vissa
 * servrar stödjer inte HEAD korrekt (svarar t.ex. 403/405 eller helt
 * annorlunda än på GET) — då faller vi tillbaka på en GET med
 * Range: bytes=0-1024 så bara början av filen hämtas, aldrig hela bilden.
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

  const headers = { 'User-Agent': USER_AGENT };

  let headResponse = null;
  try {
    headResponse = await fetchWithTimeout(parsed.toString(), { method: 'HEAD', headers });
  } catch (e) {
    headResponse = null; // nätverksfel eller timeout — provar GET nedan
  }

  if (headResponse && headResponse.ok) {
    return res.json({ valid: isImageContentType(headResponse) });
  }

  try {
    const getResponse = await fetchWithTimeout(parsed.toString(), {
      method: 'GET',
      headers: { ...headers, Range: 'bytes=0-1024' }
    });
    res.json({ valid: isImageContentType(getResponse) });
  } catch (e) {
    res.json({ valid: false });
  }
});

module.exports = router;
