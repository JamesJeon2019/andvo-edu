const { searchGoogleImages } = require('./googleImageSearch');
const { generateDalleImage } = require('./dalleImage');
const { verifyImageRelevance, summarizeConcept } = require('./visualPicker');

// Max antal Google-kandidater vi provar Claude Vision på innan vi ger upp och
// går vidare till DALL-E — enligt spec.
const MAX_ATTEMPTS = 3;

/**
 * SCENE IMAGE — hela bildupplösningen för en scen: Google Custom Search (med
 * domänprioritering + Claude Vision-relevanskontroll, max 3 försök), sedan
 * DALL-E 3 som reserv, sedan en svensk sammanfattning som sista utväg för
 * platshållartext. Anropas av writer.js under lektionsgenereringen — körs
 * ALDRIG från klienten, så eleven/läraren gör inga egna bild-API-anrop.
 */
async function resolveSceneImage({ voice_text, image_search_query }) {
  const concept = (image_search_query || voice_text || '').trim();

  if (concept) {
    const candidates = await searchGoogleImages(concept);
    for (const candidate of candidates.slice(0, MAX_ATTEMPTS)) {
      const isMatch = await verifyImageRelevance({ image_url: candidate.url, concept });
      if (isMatch) {
        return {
          found: true,
          image: {
            url: candidate.url,
            credit: candidate.displayLink || 'Google-bildsökning',
            creditLink: candidate.contextLink,
            source: 'google'
          }
        };
      }
    }

    const dalle = await generateDalleImage(concept);
    if (dalle) return { found: true, image: dalle };
  }

  const summary = await summarizeConcept({ voice_text }).catch(() => null);
  return { found: false, summary };
}

module.exports = { resolveSceneImage };
