import pg from "pg";

const { Pool } = pg;

let userPool;
let userTableSetup;

const REQUIRED_USER_COLUMNS = [
  "id",
  "name",
  "email",
  "password_hash",
  "role",
  "mobile_number",
  "country",
  "created_at",
];

function getPool() {
  if (!userPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL must be set to use PostgreSQL user storage.",
      );
    }

    let databaseUrl;
    try {
      databaseUrl = new URL(connectionString);
    } catch {
      throw new Error(
        "DATABASE_URL is not a valid PostgreSQL connection URL. Use the format postgresql://USER:PASSWORD@HOST:5432/DATABASE and URL-encode special characters in the username or password.",
      );
    }

    if (
      !["postgres:", "postgresql:"].includes(databaseUrl.protocol) ||
      !databaseUrl.hostname ||
      databaseUrl.pathname.length < 2
    ) {
      throw new Error(
        "DATABASE_URL must include a PostgreSQL scheme, host, and database name. Use the format postgresql://USER:PASSWORD@HOST:5432/DATABASE.",
      );
    }

    userPool = new Pool({ connectionString });
  }
  return userPool;
}

/**
 * Verifies that the dedicated auth table has every column the app reads and
 * writes. CREATE TABLE IF NOT EXISTS silently accepts a same-named table with
 * a different shape, so fail early with an actionable message instead of a
 * cryptic Postgres error on the first registration or login.
 */
async function assertUserTableSchema() {
  const { rows } = await getPool().query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = $1`,
    ["chatbot_users"],
  );

  const present = new Set(rows.map((row) => row.column_name));
  const missing = REQUIRED_USER_COLUMNS.filter((column) => !present.has(column));

  if (missing.length > 0) {
    const error = new Error(
      `The "chatbot_users" table exists but is missing required column(s): ${missing.join(", ")}. ` +
        "Ensure that no unrelated table is using the name \"chatbot_users\", then run \"npm run db:init-users\" again. " +
        "The pre-existing \"users\" table is never used or modified by this application.",
    );
    error.status = 500;
    throw error;
  }
}

/**
 * Idempotently creates the dedicated chatbot_users auth table. Called at server
 * startup and by `npm run db:init-users`; the promise is shared so concurrent
 * calls are safe. The schema check runs before index creation so a malformed
 * table produces the descriptive error above rather than an index error.
 */
export function setupUserTable() {
  if (!userTableSetup) {
    userTableSetup = (async () => {
      await getPool().query(`
        CREATE TABLE IF NOT EXISTS chatbot_users (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL CHECK (char_length(name) > 0),
          email TEXT NOT NULL UNIQUE CHECK (char_length(email) > 0),
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'user' CHECK (char_length(role) > 0),
          mobile_number TEXT NOT NULL CHECK (char_length(mobile_number) > 0),
          country TEXT NOT NULL CHECK (char_length(country) > 0),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await assertUserTableSchema();
      await getPool().query(`
        CREATE UNIQUE INDEX IF NOT EXISTS chatbot_users_email_normalized_key
          ON chatbot_users ((lower(email)))
      `);
    })().catch((error) => {
      userTableSetup = undefined;
      throw error;
    });
  }
  return userTableSetup;
}

export async function createUser({
  name,
  email,
  passwordHash,
  role,
  mobileNumber,
  country,
}) {
  try {
    const { rows } = await getPool().query(
      `INSERT INTO chatbot_users (name, email, password_hash, role, mobile_number, country)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, email, role, mobile_number, country, created_at`,
      [name, email, passwordHash, role, mobileNumber, country],
    );
    return rows[0];
  } catch (error) {
    if (error?.code === "23505") {
      const duplicate = new Error("An account with this email already exists.");
      duplicate.status = 409;
      throw duplicate;
    }
    throw error;
  }
}

export async function findUserByEmail(email) {
  const { rows } = await getPool().query(
    `SELECT id, name, email, password_hash, role, mobile_number, country, created_at
     FROM chatbot_users WHERE email = $1`,
    [email],
  );
  return rows[0] ?? null;
}

export async function closeUserPool() {
  if (userPool) {
    await userPool.end();
    userPool = undefined;
    userTableSetup = undefined;
  }
}
