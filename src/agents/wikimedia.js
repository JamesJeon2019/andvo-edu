/**
 * WIKIMEDIA — söker Wikimedia Commons efter fria bilder. Körs server-side så
 * hela bildpipelinen (sökning + Claude-verifiering + Unsplash-reserv) kan ske
 * i ett enda anrop från klienten, i stället för flera separata anrop som
 * riskerar race conditions när eleven/läraren byter block snabbt.
 */
function stripHtml(s) {
  return String(s).replace(/<[^>]*>/g, '').trim();
}

async function searchWikimediaImages(query) {
  try {
    // -filemime:pdf/djvu utesluter Commons stora arkiv av inskannade gamla
    // böcker och tidskrifter, som annars matchar sökordstext men inte är
    // bilder att visa.
    const searchTerms = `${query} -filemime:pdf -filemime:djvu`;
    const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(searchTerms)}&gsrnamespace=6&gsrlimit=10&prop=imageinfo&iiprop=url%7Cextmetadata%7Cmime&iiurlwidth=800&format=json&origin=*`;
    // Wikimedias API-etikett kräver en beskrivande User-Agent från serverklienter —
    // utan den riskerar anropen att strypas/nekas under belastning (många scener
    // som söker samtidigt), vilket annars skulle visa sig som "bilden hittas aldrig".
    const res = await fetch(url, { headers: { 'User-Agent': 'AndvoEdu/1.0 (https://github.com/JamesJeon2019/andvo-edu; educational lesson generator)' } });
    if (!res.ok) throw new Error('Wikimedia svarade ' + res.status);
    const data = await res.json();
    const pages = (data.query && data.query.pages) ? Object.values(data.query.pages) : [];
    return pages
      .filter(p => p.imageinfo && p.imageinfo[0] && /^image\//.test(p.imageinfo[0].mime || ''))
      .map(p => {
        const info = p.imageinfo[0];
        const meta = info.extmetadata || {};
        return {
          title: p.title || '',
          mime: info.mime || '',
          url: info.thumburl || info.url,
          credit: (meta.Artist && stripHtml(meta.Artist.value)) || 'Wikimedia Commons',
          creditLink: info.descriptionurl || 'https://commons.wikimedia.org/wiki/Main_Page',
          source: 'wikimedia'
        };
      })
      .filter(img => img.url);
  } catch (e) {
    console.warn('Wikimedia Commons-bild kunde inte hämtas:', e.message);
    return [];
  }
}

module.exports = { searchWikimediaImages };
