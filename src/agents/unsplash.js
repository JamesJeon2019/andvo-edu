const UNSPLASH_API_BASE = 'https://api.unsplash.com';

/**
 * Söker Unsplash efter foton. Reservbildkälla om Wikimedia Commons inte gav
 * en bild som klarade relevanskontrollen. Körs server-side eftersom
 * Unsplash-nyckeln annars skulle behöva ligga i klientkoden och läcka till
 * varje besökare. Returnerar tyst en tom lista om nyckeln saknas eller
 * sökningen misslyckas.
 */
async function searchUnsplashPhotos(query, { perPage = 6 } = {}) {
  const apiKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!apiKey) return [];
  try {
    const url = `${UNSPLASH_API_BASE}/search/photos?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`;
    const res = await fetch(url, { headers: { Authorization: `Client-ID ${apiKey}` } });
    if (!res.ok) throw new Error(`Unsplash svarade ${res.status}`);
    const data = await res.json();
    return (data.results || [])
      .map(r => ({
        url: r.urls && (r.urls.small || r.urls.regular),
        credit: r.user ? r.user.name : 'Unsplash',
        creditLink: (r.user && r.user.links && r.user.links.html) || 'https://unsplash.com'
      }))
      .filter(img => img.url);
  } catch (e) {
    console.warn('Unsplash-sökning misslyckades:', e.message);
    return [];
  }
}

module.exports = { searchUnsplashPhotos };
