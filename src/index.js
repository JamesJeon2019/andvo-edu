require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const pool = require('./db/pool');
const lessonRoutes = require('./routes/lesson');
const imageRoutes = require('./routes/image');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────
app.use(cors());
// Höjd gräns — "Skapa från lärobok" skickar foton av läroboksidor som
// base64 i JSON-body, vilket annars slår i express default på 100kb.
// Fotona skalas ner på klienten innan uppladdning (se materialImages i
// public/index.html), så 20mb är extra marginal snarare än det som
// normalt förväntas användas.
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// Rate limit — skydd mot spam av AI-anrop. /status pollas var 3:e sekund av
// frontend under generering och ska inte räknas mot samma gräns.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuter
  max: 30,
  message: { error: 'För många förfrågningar, vänta lite.' },
  skip: (req) => req.method === 'GET' && /\/status$/.test(req.path)
});
app.use('/api/', limiter);

// ── Routes ─────────────────────────────────────────
app.use('/api/lesson', lessonRoutes);
app.use('/api/image', imageRoutes);

// Startsida
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Health check för Render
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', service: 'andvo-edu' });
});

// ── Felhantering för body-parsern ───────────────────
// express.json() svarar annars med en HTML-felsida när body:n är för stor
// eller inte går att tolka som JSON, vilket får frontendens res.json() att
// krascha på "Unexpected token '<'". Svarar med JSON istället, så
// frontend alltid kan lita på att svaret är parsbart.
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Bilderna är för stora, försök med färre eller mindre bilder' });
  }
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'Ogiltig förfrågan, försök igen' });
  }
  next(err);
});

// ── Databasmigrering ─────────────────────────────────
// Enkel "CREATE TABLE IF NOT EXISTS"-migrering vid uppstart — ingen
// fullständig migration-ramverk behövs för en enda tabell.
async function runMigrations() {
  const schema = fs.readFileSync(path.join(__dirname, 'db/schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('✅ Databasschema klart');
}

// ── Start ───────────────────────────────────────────
runMigrations()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✅ Andvo Edu igång på port ${PORT}`);
      console.log(`🌐 http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('❌ Kunde inte köra databasmigrering:', error.message);
    process.exit(1);
  });
