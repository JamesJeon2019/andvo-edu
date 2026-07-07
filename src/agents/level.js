/**
 * LEVEL — language instructions for planner.js and writer.js.
 *
 * Every lesson is always written for Swedish year 7-9 (högstadiet), no
 * matter what the teacher types in the topic field. The chosen student
 * level (Grundläggande / Medel / Avancerad) only changes the depth and
 * complexity of the language used — it never raises the curriculum to
 * gymnasium or university level.
 */

const GRADE_LEVEL_LABEL = 'Årskurs 7-9 (högstadiet)';

const LEVEL_LABEL = {
  weak: 'Grundläggande',
  mid: 'Medel',
  strong: 'Avancerad'
};

const LEVEL_INSTRUCTIONS = {
  weak: `SPRÅKNIVÅ (STRIKT): ${GRADE_LEVEL_LABEL}, nivå Grundläggande. Använd mycket enkel svenska, endast vardagsanalogier, noll vetenskaplig fackjargong.
- Förklara ETT begrepp i taget. Blanda aldrig flera nya begrepp i samma mening.
- Använd konkreta analogier från vardagen (t.ex. LEGO-bitar, magneter på kylskåpet, kompisar som delar godis, ett rep i dragkamp) i stället för abstrakta definitioner.
- Undvik alla fackord. Om ett svårt ord ändå är nödvändigt, ersätt det med en vardaglig förklaring i stället för fackordet.`,

  mid: `SPRÅKNIVÅ: ${GRADE_LEVEL_LABEL}, nivå Medel. Standardförklaring för årskurs 7-9 — inför facktermer men förklara dem alltid tydligt första gången de används.`,

  strong: `SPRÅKNIVÅ: ${GRADE_LEVEL_LABEL}, nivå Avancerad. Djupare resonemang, korrekt vetenskaplig terminologi och mer utmanande uppgifter — men ALLTID på årskurs 7-9-nivå. Aldrig universitets- eller gymnasienivå, oavsett ämne.`
};

function languageInstructionsFor(level) {
  return LEVEL_INSTRUCTIONS[level] || LEVEL_INSTRUCTIONS.mid;
}

module.exports = { languageInstructionsFor, LEVEL_LABEL, GRADE_LEVEL_LABEL };
