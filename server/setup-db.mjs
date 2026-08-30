import { closeDatabase, initializeDatabase } from "./database.mjs";

try {
  await initializeDatabase({ applySchema: true });
  console.log("SukatAI MariaDB schema is ready.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
