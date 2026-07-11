import { createDb, type Database } from "@latticeag/vekinbox-db";

let db: Database | null = null;

export function getDb(): Database {
  if (!db) {
    const url = process.env["DATABASE_URL"];
    if (!url) {
      throw new Error("DATABASE_URL is not set");
    }
    db = createDb(url);
  }
  return db;
}
