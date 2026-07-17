const pool = require('./pool');

/**
 * Hämtar en lektions fulla data-objekt via id, eller null om den inte finns.
 */
async function getLesson(id) {
  const { rows } = await pool.query('SELECT data FROM lessons WHERE id = $1', [id]);
  return rows.length ? rows[0].data : null;
}

/**
 * Upsertar en lektion. Hela lesson-objektet sparas i data (JSONB);
 * subject/level/mode/title bryts ut ur samma objekt för framtida
 * list/filter-vyer. mode härleds från data.source ('material' → 'material',
 * annars 'ai', se runGeneration/runGenerationFromMaterial i routes/lesson.js).
 */
async function saveLesson(id, data) {
  const subject = data.subject ?? null;
  const level = data.level ?? null;
  const mode = data.source === 'material' ? 'material' : 'ai';
  const title = data.title ?? null;

  await pool.query(
    `INSERT INTO lessons (id, data, subject, level, mode, title)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET
       data = EXCLUDED.data,
       subject = EXCLUDED.subject,
       level = EXCLUDED.level,
       mode = EXCLUDED.mode,
       title = EXCLUDED.title,
       updated_at = now()`,
    [id, data, subject, level, mode, title]
  );
}

/**
 * Markerar en lektion som arkiverad (status = 'archived').
 */
async function archiveLesson(id) {
  await pool.query(
    "UPDATE lessons SET status = 'archived', updated_at = now() WHERE id = $1",
    [id]
  );
}

/**
 * Listar lektioner utan fullständig data — för en framtida lista-vy.
 * Filtrerar valfritt på status ('draft' | 'archived').
 */
async function listLessons({ status } = {}) {
  const params = [];
  let query = 'SELECT id, title, subject, mode, status, created_at FROM lessons';
  if (status) {
    params.push(status);
    query += ` WHERE status = $${params.length}`;
  }
  query += ' ORDER BY created_at DESC';

  const { rows } = await pool.query(query, params);
  return rows;
}

/**
 * Tar bort en lektion permanent.
 */
async function deleteLesson(id) {
  await pool.query('DELETE FROM lessons WHERE id = $1', [id]);
}

module.exports = { getLesson, saveLesson, archiveLesson, listLessons, deleteLesson };
