const Database = require("better-sqlite3");
const db = new Database("data/iptv_sqlite.db");
const rows = db.prepare("SELECT id, name FROM channels WHERE name LIKE '%线路%'").all();
console.log("Channels:", rows);
const sources = db.prepare("SELECT id, url, channelId FROM sources WHERE url LIKE '%线路%'").all();
console.log("Sources:", sources.length);
