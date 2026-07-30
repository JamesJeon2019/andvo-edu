// Skyddar routes som kräver inloggad skola. Inte kopplad till någon route
// ännu — se routes/lesson.js (kommande steg).
function requireAuth(req, res, next) {
  if (!req.session || !req.session.schoolId) {
    return res.status(401).json({ error: 'Inte inloggad' });
  }
  next();
}

module.exports = requireAuth;
