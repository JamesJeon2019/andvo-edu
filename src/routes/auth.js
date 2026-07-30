const express = require('express');
const router = express.Router();
const { verifySchoolLogin, getSchoolById } = require('../db/schoolStore');

/**
 * POST /api/auth/login
 * Loggar in en skola med username/password. Sätter req.session.schoolId
 * vid lyckad inloggning.
 */
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(401).json({ error: 'Fel användarnamn eller lösenord' });
  }

  const school = await verifySchoolLogin(username, password);
  if (!school) {
    return res.status(401).json({ error: 'Fel användarnamn eller lösenord' });
  }

  req.session.schoolId = school.id;
  res.json({ success: true, school: { id: school.id, name: school.name } });
});

/**
 * POST /api/auth/logout
 * Förstör den inloggade skolans session.
 */
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

/**
 * GET /api/auth/me
 * Returnerar den inloggade skolan utifrån sessionen, eller 401 om ingen
 * skola är inloggad.
 */
router.get('/me', async (req, res) => {
  if (!req.session || !req.session.schoolId) {
    return res.status(401).json({ school: null });
  }

  const school = await getSchoolById(req.session.schoolId);
  if (!school) {
    return res.status(401).json({ school: null });
  }

  res.json({ school: { id: school.id, name: school.name } });
});

module.exports = router;
