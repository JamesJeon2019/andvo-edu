const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const pool = require('./pool');

const SALT_ROUNDS = 10;

/**
 * Skapar en ny skola med hashat lösenord. Returnerar den skapade posten
 * utan password_hash.
 */
async function createSchool(name, username, password) {
  const id = uuidv4();
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const { rows } = await pool.query(
    `INSERT INTO schools (id, name, username, password_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, username, created_at`,
    [id, name, username, passwordHash]
  );
  return rows[0];
}

/**
 * Verifierar inloggning mot username/password. Returnerar skolan (utan
 * password_hash) vid lyckad matchning, annars null.
 */
async function verifySchoolLogin(username, password) {
  const { rows } = await pool.query(
    'SELECT id, name, username, password_hash, created_at FROM schools WHERE username = $1',
    [username]
  );
  if (!rows.length) return null;

  const school = rows[0];
  const match = await bcrypt.compare(password, school.password_hash);
  if (!match) return null;

  delete school.password_hash;
  return school;
}

/**
 * Hämtar en skola via id, utan password_hash, eller null om den inte finns.
 */
async function getSchoolById(id) {
  const { rows } = await pool.query(
    'SELECT id, name, username, created_at FROM schools WHERE id = $1',
    [id]
  );
  return rows.length ? rows[0] : null;
}

module.exports = { createSchool, verifySchoolLogin, getSchoolById };
