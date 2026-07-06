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
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Rate limit — skydd mot spam av AI-anrop
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuter
  max: 30,
  message: { error: 'För många förfrågningar, vänta lite.' }
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
