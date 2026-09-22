import fs from "node:fs/promises";
import mariadb from "mariadb";
import { config, projectRoot, safeDatabaseIdentifier } from "./config.mjs";

let pool = null;

function connectionOptions(includeDatabase = true, { multipleStatements = false } = {}) {
  return {
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    ...(includeDatabase ? { database: config.db.name } : {}),
    // DATETIME columns are UTC values written explicitly by the API. Return
    // them as strings so the API can append the UTC designator instead of
    // letting the Windows local timezone shift them eight hours backward.
    dateStrings: true,
    timezone: "Z",
    decimalAsNumber: true,
    insertIdAsNumber: false,
    // multipleStatements stays OFF on the request-serving pool. It is only
    // enabled on the short-lived connection that applies the multi-statement
    // schema file, so a future query-building bug cannot become a stacked-query
    // injection against live traffic.
    multipleStatements,
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

async function ensureColumn(tableName, columnName, definition) {
  const existing = await pool.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1",
    [config.db.name, tableName, columnName],
  );
  if (existing.length === 0) {
    await pool.query(`ALTER TABLE ${safeDatabaseIdentifier(tableName)} ADD COLUMN ${safeDatabaseIdentifier(columnName)} ${definition}`);
  }
}

async function ensureIndex(tableName, indexName, definition) {
  const existing = await pool.query(
    "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1",
    [config.db.name, tableName, indexName],
  );
  if (existing.length === 0) {
    await pool.query(`ALTER TABLE ${safeDatabaseIdentifier(tableName)} ADD ${definition}`);
  }
}

export async function initializeDatabase({ applySchema = true } = {}) {
  await ensureDatabase();
  pool = mariadb.createPool({ ...connectionOptions(true), connectionLimit: config.db.connectionLimit });
  if (applySchema) {
    const schemaPath = `${projectRoot}/xampp/database/sukatai.sql`;
    const schema = await fs.readFile(schemaPath, "utf8");
    // The schema file contains multiple statements, so apply it on a dedicated
    // short-lived connection that opts into multipleStatements rather than the
    // request-serving pool.
    const schemaConnection = await mariadb.createConnection(connectionOptions(true, { multipleStatements: true }));
    try {
      await schemaConnection.query(schema);
    } finally {
      await schemaConnection.end();
    }
  }
  await ensureColumn("users", "phone", "VARCHAR(32) NULL AFTER email");
  await ensureColumn("users", "email_notifications", "TINYINT(1) NOT NULL DEFAULT 1 AFTER phone");
  await ensureColumn("users", "sms_notifications", "TINYINT(1) NOT NULL DEFAULT 0 AFTER email_notifications");
  // Email-OTP account verification columns. Added idempotently so an existing
  // populated users table gains them without data loss (the schema file only
  // runs CREATE TABLE IF NOT EXISTS and never alters an existing table).
  await ensureColumn("users", "email_verified", "TINYINT(1) NOT NULL DEFAULT 0 AFTER reset_expires_at");
  await ensureColumn("users", "verified_at", "DATETIME NULL AFTER email_verified");
  await ensureColumn("users", "otp_hash", "CHAR(64) NULL AFTER verified_at");
  await ensureColumn("users", "otp_expires_at", "DATETIME NULL AFTER otp_hash");
  await ensureColumn("users", "otp_attempts", "TINYINT NOT NULL DEFAULT 0 AFTER otp_expires_at");
  await ensureColumn("users", "otp_last_sent_at", "DATETIME NULL AFTER otp_attempts");
  // One-time backfill: every account that predates the OTP feature is marked
  // verified so only NEW signups are gated. A pending signup always carries a
  // non-null otp_hash, so it is never caught here. Idempotent (no-op once done).
  await pool.query(
    "UPDATE users SET email_verified = 1, verified_at = COALESCE(verified_at, created_at) WHERE email_verified = 0 AND otp_hash IS NULL",
  );
  await ensureColumn("notifications", "event_key", "VARCHAR(180) NULL AFTER metadata");
  await ensureColumn("scans", "processing_attempts", "INT NOT NULL DEFAULT 0 AFTER processing_version");
  await ensureColumn("scans", "processing_attempt_id", "CHAR(36) NULL AFTER processing_attempts");
  await ensureColumn("scans", "processing_started_at", "DATETIME NULL AFTER processing_attempts");
  await ensureColumn("scans", "processing_completed_at", "DATETIME NULL AFTER processing_started_at");
  await ensureColumn("scans", "processing_error_code", "VARCHAR(80) NULL AFTER processing_completed_at");
  await ensureColumn("scans", "processing_status", "VARCHAR(16) NOT NULL DEFAULT 'queued' AFTER processing_error_code");
  await ensureColumn("scans", "processing_progress", "TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER processing_status");
  await ensureColumn("scans", "processing_progress_reported", "TINYINT(1) NOT NULL DEFAULT 0 AFTER processing_progress");
  await ensureColumn("scans", "processing_error", "VARCHAR(1000) NULL AFTER processing_progress");
  await ensureColumn("measurements", "measurement_method", "VARCHAR(40) NULL AFTER confidence");
  await ensureColumn("measurements", "measurement_source", "VARCHAR(120) NULL AFTER measurement_method");
  await ensureColumn("orders", "open_scan_key", "VARCHAR(80) GENERATED ALWAYS AS (CASE WHEN status IN ('new', 'accepted', 'in_production', 'for_fitting', 'ready_for_pickup') AND scan_id IS NOT NULL THEN CONCAT(customer_id, ':', scan_id) ELSE NULL END) PERSISTENT");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scan_processing_attempts (
      id CHAR(36) NOT NULL,
      scan_id CHAR(36) NOT NULL,
      attempt_number INT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'queued',
      provider VARCHAR(120) NULL,
      processing_version VARCHAR(120) NULL,
      idempotency_key VARCHAR(180) NOT NULL,
      claim_token VARCHAR(80) NULL,
      quality VARCHAR(20) NULL,
      quality_issues JSON NOT NULL,
      reconstruction JSON NOT NULL,
      staged_measurements JSON NOT NULL,
      staged_model_path VARCHAR(500) NULL,
      error_code VARCHAR(80) NULL,
      error_message VARCHAR(1000) NULL,
      is_promoted TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME NULL,
      completed_at DATETIME NULL,
      promoted_at DATETIME NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY scan_attempt_number_unique (scan_id, attempt_number),
      UNIQUE KEY scan_attempt_idempotency_unique (scan_id, idempotency_key),
      KEY scan_attempts_scan_idx (scan_id, created_at)
    ) ENGINE=InnoDB
  `);
  await ensureIndex("notifications", "notifications_event_key_unique", "UNIQUE KEY `notifications_event_key_unique` (`event_key`)");
  await ensureIndex("orders", "orders_open_scan_unique", "UNIQUE KEY `orders_open_scan_unique` (`open_scan_key`)");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id CHAR(36) NOT NULL,
      notification_id CHAR(36) NULL,
      user_id CHAR(36) NULL,
      event_key VARCHAR(180) NOT NULL,
      channel VARCHAR(20) NOT NULL,
      destination VARCHAR(320) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      provider VARCHAR(40) NOT NULL DEFAULT 'console',
      provider_message_id VARCHAR(255) NULL,
      error VARCHAR(1000) NULL,
      sent_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY notification_deliveries_event_channel_unique (event_key, channel),
      KEY notification_deliveries_user_idx (user_id, created_at)
    ) ENGINE=InnoDB
  `);
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
