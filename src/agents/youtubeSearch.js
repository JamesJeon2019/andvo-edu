const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

// Konverterar ISO 8601-varaktighet (t.ex. "PT7M32S") till sekunder
function parseIsoDuration(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return 0;
  const h = parseInt(m[1] || '0', 10);
  const min = parseInt(m[2] || '0', 10);
  const s = parseInt(m[3] || '0', 10);
  return h * 3600 + min * 60 + s;
}

/**
 * Söker YouTube efter undervisningsvideos som matchar en fråga.
 * Filtrerar på längd (5–10 minuter) och rankar svenskspråkigt innehåll högst.
 */
async function searchYoutubeVideos(query, { max = 3 } = {}) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    const err = new Error('YOUTUBE_API_KEY är inte konfigurerad');
    err.code = 'NO_API_KEY';
    throw err;
  }

  const searchUrl = `${YOUTUBE_API_BASE}/search?part=snippet&type=video&maxResults=15&relevanceLanguage=sv&safeSearch=strict&videoEmbeddable=true&q=${encodeURIComponent(query)}&key=${apiKey}`;
  const searchRes = await fetch(searchUrl);
  if (!searchRes.ok) throw new Error(`YouTube search svarade ${searchRes.status}`);
  const searchData = await searchRes.json();
  const items = (searchData.items || []).filter(it => it.id && it.id.videoId);
  if (!items.length) return [];

  const ids = items.map(it => it.id.videoId).join(',');
  const detailsUrl = `${YOUTUBE_API_BASE}/videos?part=contentDetails,snippet&id=${ids}&key=${apiKey}`;
  const detailsRes = await fetch(detailsUrl);
  if (!detailsRes.ok) throw new Error(`YouTube videos svarade ${detailsRes.status}`);
  const detailsData = await detailsRes.json();

  const candidates = (detailsData.items || []).map(v => ({
    videoId: v.id,
    title: v.snippet.title,
    channel: v.snippet.channelTitle,
    thumbnail: (v.snippet.thumbnails.medium || v.snippet.thumbnails.default || {}).url,
    durationSeconds: parseIsoDuration(v.contentDetails.duration),
    language: v.snippet.defaultAudioLanguage || v.snippet.defaultLanguage || null
  }));

  // Filtrera på 5–10 minuter enligt krav; om det filtrerar bort allt, fall
  // hellre tillbaka på alla träffar än att visa noll förslag till läraren.
  const inRange = candidates.filter(v => v.durationSeconds >= 300 && v.durationSeconds <= 600);
  const pool = inRange.length ? inRange : candidates;

  const scored = pool.map(v => ({ ...v, score: (v.language && v.language.startsWith('sv')) ? 1 : 0 }));
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, max).map(({ score, ...v }) => v);
}

/**
 * Hämtar tillgängliga undertextspår för en video, för att kunna varna om
 * svensk textning saknas eller är automatiskt genererad av YouTube.
 * OBS: captions.list kräver enligt Googles dokumentation normalt OAuth 2.0 —
 * med bara en API-nyckel kan anropet nekas för vissa videor. Vi behandlar det
 * som best-effort och returnerar tyst en tom lista om det misslyckas.
 */
async function getCaptionTracks(videoId) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return [];
  try {
    const url = `${YOUTUBE_API_BASE}/captions?part=snippet&videoId=${videoId}&key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []).map(c => ({
      language: c.snippet.language,
      trackKind: c.snippet.trackKind, // 'standard' | 'ASR' (automatiskt genererad)
      name: c.snippet.name
    }));
  } catch (e) {
    return [];
  }
}

module.exports = { searchYoutubeVideos, getCaptionTracks, parseIsoDuration };
