const { searchWikimediaImages } = require('./wikimedia');
const { searchUnsplashPhotos } = require('./unsplash');
const { verifyVisualMatch, summarizeConcept } = require('./visualPicker');

// Om det förvalda image_search_query (skrivet av writer.js tillsammans med
// voice_text) inte ger en träff som klarar Claudes relevanskontroll, försöker
// vi 2 gånger till med samma grundfråga plus enkla, billiga tillägg — ingen
// ny Claude-fråga behövs, det är bara Wikimedias egen sökning som körs om.
const RETRY_SUFFIXES = ['', ' diagram', ' simple educational'];

/**
 * SCENE IMAGE — hela bildupplösningen för en scen i ETT serveranrop: Wikimedia
 * (med omförsök), sedan Unsplash, sedan en svensk sammanfattning som sista
 * utväg. Klienten gör alltså bara ett enda anrop per scen i stället för att
 * själv orkestrera flera beroende nätverksanrop — det var källan till
 * race conditions/tomma bilder när eleven bytte block mitt i laddningen.
 */
async function resolveSceneImage({ voice_text, image_search_query }) {
  const baseQuery = (image_search_query || voice_text || '').trim();

  if (baseQuery) {
    for (const suffix of RETRY_SUFFIXES) {
      const query = `${baseQuery}${suffix}`.trim();
      const wiki = await searchWikimediaImages(query);
      if (!wiki.length) continue;

      const top = wiki[0];
      const isMatch = await verifyVisualMatch({ image_title: top.title, voice_text });
      if (isMatch) return { found: true, image: top };
    }
  }

  if (baseQuery) {
    const unsplash = await searchUnsplashPhotos(baseQuery);
    if (unsplash.length) {
      const r = unsplash[0];
      return { found: true, image: { url: r.url, credit: r.credit, creditLink: r.creditLink, source: 'unsplash' } };
    }
  }

  const summary = await summarizeConcept({ voice_text }).catch(() => null);
  return { found: false, summary };
}

module.exports = { resolveSceneImage };
