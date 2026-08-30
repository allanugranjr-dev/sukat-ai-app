import fs from "node:fs/promises";
import mariadb from "mariadb";
import { config, projectRoot, safeDatabaseIdentifier } from "./config.mjs";

let pool = null;

function connectionOptions(includeDatabase = true) {
  return {
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    ...(includeDatabase ? { database: config.db.name } : {}),
    decimalAsNumber: true,
    insertIdAsNumber: false,
    multipleStatements: true,
  };
}

export async function ensureDatabase() {
  const connection = await mariadb.createConnection(connectionOptions(false));
  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${safeDatabaseIdentifier(config.db.name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await connection.end();
  }
}

export async function initializeDatabase({ applySchema = true } = {}) {
  await ensureDatabase();
  pool = mariadb.createPool({ ...connectionOptions(true), connectionLimit: config.db.connectionLimit });
  if (applySchema) {
    const schemaPath = `${projectRoot}/xampp/database/sukatai.sql`;
    const schema = await fs.readFile(schemaPath, "utf8");
    await pool.query(schema);
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash CHAR(64) NOT NULL,
      user_id CHAR(36) NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (token_hash),
      KEY sessions_user_idx (user_id),
      KEY sessions_expiry_idx (expires_at)
    ) ENGINE=InnoDB
  `);
  await pool.query("DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP()");
  return pool;
}

export function database() {
  if (!pool) throw new Error("The MariaDB pool has not been initialized.");
  return pool;
}

export async function rows(sql, params = []) {
  const result = await database().query(sql, params);
  return Array.isArray(result) ? result : [];
}

export async function row(sql, params = []) {
  return (await rows(sql, params))[0] ?? null;
}

export async function execute(sql, params = []) {
  return database().query(sql, params);
}

export async function transaction(callback) {
  const connection = await database().getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
