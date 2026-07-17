// Patchar console.log/warn/error en gång, globalt, så att ALLA loggrader i
// projektet (inklusive de i tredjepartsbibliotek) får en tidsstämpel. Gör det
// möjligt att se i vilken ordning parallella requests faktiskt loggade, utan
// att behöva ändra varje enskilt anrop.
const originalLog = console.log.bind(console);
const originalWarn = console.warn.bind(console);
const originalError = console.error.bind(console);

function timestamp() {
  return new Date().toTimeString().slice(0, 8); // HH:MM:SS
}

console.log = (...args) => originalLog(`[${timestamp()}]`, ...args);
console.warn = (...args) => originalWarn(`[${timestamp()}]`, ...args);
console.error = (...args) => originalError(`[${timestamp()}]`, ...args);

/**
 * Returnerar log/warn/error-funktioner som, utöver tidsstämpeln ovan, även
 * taggar varje rad med ett request-ID (t.ex. lessonId) — så att loggrader
 * från flera samtidiga requests går att särskilja i konsolen.
 */
function scoped(id) {
  const tag = `[${id}]`;
  return {
    log: (...args) => console.log(tag, ...args),
    warn: (...args) => console.warn(tag, ...args),
    error: (...args) => console.error(tag, ...args)
  };
}

module.exports = { scoped };
