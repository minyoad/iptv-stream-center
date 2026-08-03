import Database from "better-sqlite3";
import path from "path";
const db = new Database(path.join(process.cwd(), "data", "iptv_sqlite.db"));
try {
  db.exec("ALTER TABLE sync_configs ADD COLUMN aliasOnly INTEGER DEFAULT 0");
  console.log("Added aliasOnly column");
} catch (e) {
  console.log("Column may already exist:", e);
}
