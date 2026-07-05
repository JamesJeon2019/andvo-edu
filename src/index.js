require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

const lessonRoutes = require('./routes/lesson');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Rate limit — защита от спама запросами к AI
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 30,
  message: { error: 'Слишком много запросов, подождите немного.' }
});
app.use('/api/', limiter);

// ── Routes ─────────────────────────────────────────
app.use('/api/lesson', lessonRoutes);

// Главная страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Health check для Render
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', service: 'andvo-edu' });
});

// ── Start ───────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Andvo Edu запущен на порту ${PORT}`);
  console.log(`🌐 http://localhost:${PORT}`);
});
