/**
 * GRADE LEVEL — avgör vilken årskursnivå ett lektionsämne riktar sig till, och
 * ger språkinstruktioner som planner.js och writer.js injicerar i sina prompts.
 * Nyckelord i ämnestexten (t.ex. "årskurs 7-9", "gymnasiet") väger tyngre än
 * den valda elevnivån (Svag/Medel/Avancerad), eftersom läraren kan ha skrivit
 * en explicit årskurs i ämnesfältet.
 *
 * "Avancerad" elevnivå gör INNEHÅLLET djupare (se levelMap i writer.js) men
 * ska inte i sig slå på gymnasiets fackjargong — språket ska strikt hållas på
 * årskurs 7-9-nivå såvida inte läraren uttryckligen skriver "gymnasiet" i
 * ämnesfältet. Annars blir "Avancerad" oavsiktligt otillgängligt för elever.
 */
function detectGradeLevel(topic, level) {
  const t = (topic || '').toLowerCase();

  if (/årskurs\s*4\s*-\s*6|årskurs\s*[456]\b|mellanstadi(et|um)/.test(t)) return 'elementary';
  if (/gymnasi(et|um)/.test(t)) return 'highschool';
  if (/årskurs\s*7\s*-\s*9|årskurs\s*[789]\b|högstadi(et|um)|grundskola/.test(t)) return 'middleschool';

  // Ingen årskurs nämnd i ämnet — falla tillbaka på elevnivån.
  // Standard = högstadienivå (middleschool), strikt enkelt språk, oavsett
  // vald elevnivå (även "Avancerad" stannar på årskurs 7-9-språk som default).
  if (level === 'weak') return 'elementary';
  return 'middleschool';
}

const GRADE_LEVEL_LABEL = {
  elementary: 'Årskurs 4-6 (mellanstadiet)',
  middleschool: 'Årskurs 7-9 (högstadiet)',
  highschool: 'Gymnasiet'
};

function languageInstructionsFor(gradeLevel) {
  if (gradeLevel === 'highschool') {
    return `SPRÅKNIVÅ: ${GRADE_LEVEL_LABEL.highschool}. Standardnivå med korrekta facktermer — men förklara dem tydligt första gången de används. Djupare resonemang, formler och samband mellan begrepp är tillåtet.`;
  }

  const label = GRADE_LEVEL_LABEL[gradeLevel] || GRADE_LEVEL_LABEL.middleschool;
  return `SPRÅKNIVÅ (STRIKT): ${label}. Använd ENDAST enkelt vardagsspråk — ingen fackjargong, ingen universitetsnivå-analys, oavsett vilket ämne lektionen handlar om.
- Förklara ETT begrepp i taget. Blanda aldrig flera nya begrepp i samma mening.
- Använd konkreta analogier från vardagen (t.ex. LEGO-bitar, magneter på kylskåpet, kompisar som delar godis, ett rep i dragkamp) i stället för abstrakta definitioner.
- Max 2-3 meningar per scen (voice_text) — korta, enkla meningar.
- Bedöm själv vilka ord som är för avancerad fackjargong för denna årskurs inom just detta ämne, och undvik dem. Om ett svårt ord ändå är nödvändigt, ersätt det med en vardaglig förklaring i stället för fackordet.`;
}

module.exports = { detectGradeLevel, languageInstructionsFor, GRADE_LEVEL_LABEL };
