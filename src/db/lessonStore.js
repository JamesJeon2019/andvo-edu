const pool = require('./pool');

/**
 * Hämtar en lektions fulla data-objekt via id, scopat till schoolId, eller
 * null om den inte finns ELLER tillhör en annan skola (samma svar i båda
 * fallen, så att ett gissat ID inte avslöjar om lektionen existerar).
 */
async function getLesson(id, schoolId) {
  const { rows } = await pool.query(
    'SELECT data FROM lessons WHERE id = $1 AND school_id = $2',
    [id, schoolId]
  );
  return rows.length ? rows[0].data : null;
}

/**
 * Upsertar en lektion. Hela lesson-objektet sparas i data (JSONB);
 * subject/level/mode/title bryts ut ur samma objekt för framtida
 * list/filter-vyer. mode härleds från data.source ('material' → 'material',
 * annars 'ai', se runGeneration/runGenerationFromMaterial i routes/lesson.js).
 * school_id sätts bara vid insert — ON CONFLICT uppdaterar den aldrig, så en
 * lektion kan inte byta ägare via ett vanligt save-anrop.
 */
async function saveLesson(id, data, schoolId) {
  const subject = data.subject ?? null;
  const level = data.level ?? null;
  const mode = data.source === 'material' ? 'material' : 'ai';
  const title = data.title ?? null;

  await pool.query(
    `INSERT INTO lessons (id, data, subject, level, mode, title, school_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET
       data = EXCLUDED.data,
       subject = EXCLUDED.subject,
       level = EXCLUDED.level,
       mode = EXCLUDED.mode,
       title = EXCLUDED.title,
       updated_at = now()`,
    [id, data, subject, level, mode, title, schoolId]
  );
}

/**
 * Markerar en lektion som arkiverad (status = 'archived'), scopat till
 * schoolId.
 */
async function archiveLesson(id, schoolId) {
  await pool.query(
    "UPDATE lessons SET status = 'archived', updated_at = now() WHERE id = $1 AND school_id = $2",
    [id, schoolId]
  );
}

/**
 * Listar lektioner utan fullständig data — för en framtida lista-vy.
 * schoolId är obligatoriskt och filtreras alltid på. Filtrerar även
 * valfritt på status ('draft' | 'archived').
 */
async function listLessons({ status, schoolId }) {
  const params = [schoolId];
  let query = 'SELECT id, title, subject, mode, status, created_at FROM lessons WHERE school_id = $1';
  if (status) {
    params.push(status);
    query += ` AND status = $${params.length}`;
  }
  query += ' ORDER BY created_at DESC';

  const { rows } = await pool.query(query, params);
  return rows;
}

/**
 * Tar bort en lektion permanent, scopat till schoolId.
 */
async function deleteLesson(id, schoolId) {
  await pool.query('DELETE FROM lessons WHERE id = $1 AND school_id = $2', [id, schoolId]);
}

module.exports = { getLesson, saveLesson, archiveLesson, listLessons, deleteLesson };
