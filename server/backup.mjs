import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";

import { config } from "./config.mjs";
import { closeDatabase, initializeDatabase } from "./database.mjs";

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function dumpBinary() {
  if (process.env.SUKATAI_DB_DUMP_BIN) return process.env.SUKATAI_DB_DUMP_BIN;
  if (process.platform === "win32") return "C:\\xampp\\mysql\\bin\\mysqldump.exe";
  return "mariadb-dump";
}

async function runDump(destination) {
  await new Promise((resolve, reject) => {
    const child = spawn(dumpBinary(), [
      "--single-transaction",
      "--routines",
      "--events",
      "--triggers",
      "--hex-blob",
      "--host", config.db.host,
      "--port", String(config.db.port),
      "--user", config.db.user,
      "--databases", config.db.name,
    ], {
      env: { ...process.env, MYSQL_PWD: config.db.password },
      windowsHide: true,
    });
    const output = createWriteStream(destination, { encoding: "utf8" });
    let errorOutput = "";
    child.stdout.pipe(output);
    child.stderr.on("data", (chunk) => { errorOutput += chunk.toString(); });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      output.close(() => {
        if (code === 0) resolve();
        else reject(new Error(errorOutput.trim() || ("Database dump exited with code " + code + ".")));
      });
    });
  });
}

try {
  await initializeDatabase({ applySchema: false });
  const backupRoot = path.resolve(process.cwd(), process.env.SUKATAI_BACKUP_DIR ?? "backups");
  const backupDirectory = path.join(backupRoot, "sukatai-" + timestamp());
  await fs.mkdir(backupDirectory, { recursive: true });
  await runDump(path.join(backupDirectory, "sukatai.sql"));
  await fs.mkdir(config.storageDirectory, { recursive: true });
  await fs.cp(config.storageDirectory, path.join(backupDirectory, "storage"), { recursive: true, force: true });
  console.log("SukatAI backup created at " + backupDirectory);
  console.log("Includes the MariaDB dump and local scan storage.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
