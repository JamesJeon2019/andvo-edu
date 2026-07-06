const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

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

module.exports = { getCaptionTracks };
