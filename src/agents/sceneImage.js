const { searchGoogleImages } = require('./googleImageSearch');
const { generateDalleImage } = require('./dalleImage');
const { verifyImageRelevance } = require('./visualPicker');

// Max antal Google-kandidater vi provar Claude Vision på innan vi ger upp och
// går vidare till DALL-E — enligt spec.
const MAX_ATTEMPTS = 3;

/**
 * SCENE IMAGE — bildupplösningen för EN scen, anropad on-demand av
 * GET /api/image/search (src/routes/image.js) när klienten progressivt
 * laddar bilder EFTER att lektionen redan visas. Körs aldrig under själva
 * lektionsgenereringen (se writer.js) — bara sökfrågan/konceptet skrivs där.
 *
 * Ordning: Google Custom Search (max 3 kandidater, Claude Vision-
 * relevanskontroll) → DALL-E 3-reserv → null (klienten visar då
 * image_concept-texten den redan har).
 */
async function resolveSceneImage({ query, concept }) {
  const searchQuery = (query || concept || '').trim();
  const matchConcept = (concept || query || '').trim();

  if (!searchQuery) {
    console.warn('[sceneImage] Ingen sökfråga att lösa bild för.');
    return { found: false, image: null };
  }

  const candidates = await searchGoogleImages(searchQuery);
  console.log(`[sceneImage] "${searchQuery}" — ${candidates.length} kandidat(er) hittades`);

  for (const candidate of candidates.slice(0, MAX_ATTEMPTS)) {
    const isMatch = await verifyImageRelevance({ image_url: candidate.url, concept: matchConcept });
    console.log(`[sceneImage] Vision-kontroll "${matchConcept}" mot ${candidate.url} → ${isMatch ? 'JA' : 'NEJ'}`);
    if (isMatch) return { found: true, image: candidate };
  }

  console.log(`[sceneImage] "${searchQuery}" — ingen godkänd Google-bild, provar DALL-E`);
  const dalle = await generateDalleImage(matchConcept);
  if (dalle) {
    console.log(`[sceneImage] "${searchQuery}" — DALL-E lyckades`);
    return { found: true, image: dalle };
  }

  console.warn(`[sceneImage] "${searchQuery}" — DALL-E misslyckades eller ej konfigurerad`);
  return { found: false, image: null };
}

module.exports = { resolveSceneImage };
