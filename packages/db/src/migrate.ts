import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb, closeDb } from "./client.js";

async function main() {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const db = createDb(connectionString);

  try {
    await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
    console.log("Migrations applied successfully");
  } finally {
    await closeDb(db);
  }
}

main().catch((error: unknown) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
