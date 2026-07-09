require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

const lessonRoutes = require('./routes/lesson');
const imageRoutes = require('./routes/image');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────
app.use(cors());
// Höjd gräns — "Skapa från lärobok" skickar foton av läroboksidor som
// base64 i JSON-body, vilket annars slår i express default på 100kb.
app.use(express.json({ limit: '15mb' }));
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

// ── Start ───────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Andvo Edu igång på port ${PORT}`);
  console.log(`🌐 http://localhost:${PORT}`);
});
