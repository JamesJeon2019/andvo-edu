const { Pool } = require('pg');

// Single shared pg.Pool for the whole app. Connection string comes from
// DATABASE_URL (Neon/managed Postgres) — never hardcode credentials here.
// rejectUnauthorized: false is the standard setting for Neon's managed
// SSL cert chain, which Node's default trust store doesn't recognize.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

module.exports = pool;
