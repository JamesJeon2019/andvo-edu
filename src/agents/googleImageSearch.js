const GOOGLE_SEARCH_BASE = 'https://www.googleapis.com/customsearch/v1';

// Källor vi litar på för korrekta undervisningsdiagram — resultat från dessa
// domäner prioriteras före övriga träffar innan Claude Vision relevanskontroll.
const PREFERRED_DOMAINS = ['wikipedia.org', 'wikimedia.org', '.edu', 'khanacademy.org'];

function domainRank(text) {
  const lower = (text || '').toLowerCase();
  const idx = PREFERRED_DOMAINS.findIndex(d => lower.includes(d));
  return idx === -1 ? PREFERRED_DOMAINS.length : idx;
}

/**
 * GOOGLE IMAGE SEARCH — söker Google Custom Search efter undervisningsbilder
 * för det exakta vetenskapliga konceptet (frågan skrivs av writer.js). Körs
 * server-side under lektionsgenereringen, aldrig från klienten.
 */
async function searchGoogleImages(query, { num = 5 } = {}) {
  const apiKey = process.env.GOOGLE_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_ENGINE_ID;
  if (!apiKey || !cx) return [];

  try {
    const url = `${GOOGLE_SEARCH_BASE}?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}&searchType=image&safe=active&num=${num}&imgType=clipart&imgColorType=mono`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Google Custom Search svarade ${res.status}${body ? ` — ${body.slice(0, 300)}` : ''}`);
    }
    const data = await res.json();

    const items = (data.items || [])
      .map(it => ({
        url: it.link,
        credit: it.displayLink || 'Google-bildsökning',
        creditLink: (it.image && it.image.contextLink) || it.link,
        source: 'google'
      }))
      .filter(img => img.url);

    items.sort((a, b) => domainRank(a.credit) - domainRank(b.credit));
    console.log(`[googleImageSearch] "${query}" → ${items.length} kandidat(er)`);
    return items;
  } catch (e) {
    console.warn('[googleImageSearch] Sökning misslyckades:', e.message);
    return [];
  }
}

module.exports = { searchGoogleImages };
