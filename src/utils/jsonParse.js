/**
 * Försöker tolka en modells textsvar som JSON även när Claude, trots
 * instruktionen att bara svara med JSON, ändå skriver en inledande eller
 * avslutande mening runt objektet (t.ex. "Here is the transcription: {...}").
 * Provar först hela svaret (efter att ev. markdown-kodblock tagits bort),
 * och faller sedan tillbaka på att klippa ut allt mellan den första '{'
 * och den sista '}'. Returnerar null vid fullständigt misslyckande —
 * kastar aldrig, anroparen avgör själv om null ska hanteras som fel.
 */
function tryParseJson(rawText) {
  const stripped = rawText.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(stripped);
  } catch (e) {
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(stripped.slice(start, end + 1));
    } catch (e2) {
      return null;
    }
  }
}

module.exports = { tryParseJson };
