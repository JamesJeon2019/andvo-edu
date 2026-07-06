const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';

/**
 * DALL-E FALLBACK — sista utväg när ingen Google-bild klarade Claude Visions
 * relevanskontroll (se sceneImage.js). Genererar ett enkelt svart-vitt
 * undervisningsdiagram för det exakta konceptet. Körs server-side, aldrig
 * från klienten.
 */
async function generateDalleImage(concept) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const prompt = `Simple clear educational diagram for year 7 students showing: ${concept}. Clean black and white illustration, clear labels in Swedish, no decorative elements, scientific accuracy required`;

  try {
    const res = await fetch(OPENAI_IMAGES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt,
        size: '1024x1024',
        quality: 'standard',
        n: 1
      })
    });
    if (!res.ok) throw new Error(`DALL-E svarade ${res.status}`);
    const data = await res.json();
    const url = data.data && data.data[0] && data.data[0].url;
    if (!url) return null;

    return { url, credit: 'AI-genererad illustration (DALL-E 3)', creditLink: null, source: 'dalle' };
  } catch (e) {
    console.warn('DALL-E-bildgenerering misslyckades:', e.message);
    return null;
  }
}

module.exports = { generateDalleImage };
