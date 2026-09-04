import Database from "better-sqlite3";
import crypto from "crypto";
import { SQLITE_DB_PATH } from "../constants";

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!dbInstance) {
    dbInstance = initSqlite();
  }
  return dbInstance;
}

export function initSqlite(): Database.Database {
  if (dbInstance) return dbInstance;

  const db = new Database(SQLITE_DB_PATH);
  
  // Enable WAL mode for high performance concurrency and stability
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  // Create tables structured for fast access
  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      isolated INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      logo TEXT,
      groupIds TEXT,
      alias TEXT,
      epgId TEXT,
      description TEXT DEFAULT '',
      isolated INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      channelId TEXT NOT NULL,
      url TEXT NOT NULL,
      province TEXT,
      isp TEXT,
      status TEXT,
      latency INTEGER,
      resolution TEXT,
      lastChecked TEXT,
      clientIspReported TEXT,
      clientProvinceReported TEXT,
      testCount INTEGER DEFAULT 0,
      successCount INTEGER DEFAULT 0,
      isolated INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sync_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT,
      type TEXT,
      autoSync INTEGER,
      syncInterval INTEGER,
      lastSynced TEXT,
      status TEXT,
      message TEXT,
      disabled INTEGER,
      consecutiveFailures INTEGER,
      contentHash TEXT,
      isp TEXT,
      aliasOnly INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS epg_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT,
      active INTEGER,
      lastSynced TEXT,
      status TEXT,
      message TEXT
    );
    CREATE TABLE IF NOT EXISTS cron_jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      startTime TEXT,
      intervalMinutes INTEGER,
      active INTEGER DEFAULT 0,
      lastRun TEXT,
      nextRun TEXT
    );
    CREATE TABLE IF NOT EXISTS cron_logs (
      id TEXT PRIMARY KEY,
      jobId TEXT NOT NULL,
      runAt TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT
    );
    CREATE TABLE IF NOT EXISTS test_reports (
      id TEXT PRIMARY KEY,
      createdAt TEXT NOT NULL,
      totalTested INTEGER NOT NULL,
      activeCount INTEGER NOT NULL,
      inactiveCount INTEGER NOT NULL,
      clientIsp TEXT,
      clientProvince TEXT,
      details TEXT
    );
    
    CREATE TABLE IF NOT EXISTS carousel_proxies (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      urlTemplate TEXT NOT NULL,
      status TEXT DEFAULT 'active'
    );
    
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS client_access_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT NOT NULL,
      endpointPath TEXT NOT NULL,
      clientIp TEXT NOT NULL,
      province TEXT,
      isp TEXT,
      userAgent TEXT,
      clientApp TEXT,
      queryParams TEXT,
      statusCode INTEGER DEFAULT 200,
      responseBytes INTEGER DEFAULT 0,
      accessTime DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Ensure optimized indices for speedy lookups
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_client_access_logs_time ON client_access_logs(accessTime DESC);
    CREATE INDEX IF NOT EXISTS idx_client_access_logs_endpoint ON client_access_logs(endpoint);
    CREATE INDEX IF NOT EXISTS idx_client_access_logs_ip ON client_access_logs(clientIp);
    CREATE INDEX IF NOT EXISTS idx_sources_channelId ON sources(channelId);
    CREATE INDEX IF NOT EXISTS idx_sources_status ON sources(status);
    CREATE INDEX IF NOT EXISTS idx_test_reports_createdAt ON test_reports(createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_carousel_proxies_platform ON carousel_proxies(platform);
    CREATE TABLE IF NOT EXISTS carousel_channels (
      id TEXT PRIMARY KEY,
      channelId TEXT NOT NULL,
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      originalId TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_carousel_channels_pid ON carousel_channels(platform, originalId);
    CREATE TABLE IF NOT EXISTS carousel_discovery_rules (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      keyword TEXT NOT NULL,
      enabled INTEGER DEFAULT 1
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_carousel_discovery_rules_keyword ON carousel_discovery_rules(keyword);
    CREATE TABLE IF NOT EXISTS carousel_disabled_rules (
      id TEXT PRIMARY KEY,
      pattern TEXT NOT NULL,
      type TEXT DEFAULT 'contains',
      platform TEXT DEFAULT '',
      description TEXT DEFAULT '',
      enabled INTEGER DEFAULT 1,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_carousel_disabled_rules_pattern ON carousel_disabled_rules(pattern, platform);
    CREATE TABLE IF NOT EXISTS deleted_carousel_proxies (
      urlTemplate TEXT PRIMARY KEY,
      deletedAt TEXT
    );
  `);

  // Column migration for carousel_discovery_rules enabled column
  try {
    db.prepare("ALTER TABLE carousel_discovery_rules ADD COLUMN enabled INTEGER DEFAULT 1").run();
  } catch (e) {}

  // Column migration for channels description column
  try {
    db.prepare("ALTER TABLE channels ADD COLUMN description TEXT DEFAULT ''").run();
  } catch (e) {}

  // Seed default carousel proxies (only on first startup initialization)
  const seedProxies = [
    { id: crypto.randomUUID(), platform: 'yy', urlTemplate: 'http://11.xmyxc.cn/api/php/yy.php?id={}', status: 'active' },
    { id: crypto.randomUUID(), platform: 'yy', urlTemplate: 'https://lunbo.freetv.top/yy/{}', status: 'active' },
    { id: crypto.randomUUID(), platform: 'yy', urlTemplate: 'http://cfss.cc/cdn/yy/{}.flv', status: 'active' },
    { id: crypto.randomUUID(), platform: 'douyu', urlTemplate: 'https://diyp.zxyxndc.top/douyu/{}', status: 'active' },
    { id: crypto.randomUUID(), platform: 'douyu', urlTemplate: 'http://live.iill.top/douyu.php?id={}', status: 'active' },
    { id: crypto.randomUUID(), platform: 'huya', urlTemplate: 'http://8.155.43.98:35455/huya/{}', status: 'active' },
    { id: crypto.randomUUID(), platform: 'bilibili', urlTemplate: 'http://live.iill.top/bilibili.php?id={}', status: 'active' },
    { id: crypto.randomUUID(), platform: 'migu', urlTemplate: 'https://lunbo.freetv.top/migu/{}', status: 'active' },
    { id: crypto.randomUUID(), platform: 'migu', urlTemplate: 'http://live.iill.top/migu.php?id={}', status: 'active' },
    { id: crypto.randomUUID(), platform: 'migu', urlTemplate: 'http://127.0.0.1:35455/migu/{}', status: 'active' },
    { id: crypto.randomUUID(), platform: 'cntv', urlTemplate: 'https://lunbo.freetv.top/cntv/{}.m3u8', status: 'active' },
    { id: crypto.randomUUID(), platform: 'kuaishou', urlTemplate: 'http://live.iill.top/kuaishou.php?id={}', status: 'active' },
    { id: crypto.randomUUID(), platform: 'douyin', urlTemplate: 'http://live.iill.top/douyin.php?id={}', status: 'active' }
  ];

  try {
    const isProxiesInit = db.prepare("SELECT value FROM system_settings WHERE key = 'carousel_proxies_initialized'").get() as any;
    if (!isProxiesInit) {
      const proxyCount = (db.prepare('SELECT COUNT(*) as count FROM carousel_proxies').get() as any).count;
      if (proxyCount === 0) {
        const stmt = db.prepare('INSERT INTO carousel_proxies (id, platform, urlTemplate, status) VALUES (@id, @platform, @urlTemplate, @status)');
        const insertMany = db.transaction((proxies) => {
          for (const p of proxies) stmt.run(p);
        });
        insertMany(seedProxies);
      }
      db.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('carousel_proxies_initialized', 'true')").run();
    }
  } catch (e) {
    console.error("Error initializing carousel proxies:", e);
  }

  // Add new columns if they don't exist
  try {
    db.exec("ALTER TABLE sources ADD COLUMN testCount INTEGER DEFAULT 0");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE sources ADD COLUMN successCount INTEGER DEFAULT 0");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE sources ADD COLUMN isolated INTEGER DEFAULT 0");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE channels ADD COLUMN isolated INTEGER DEFAULT 0");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE groups ADD COLUMN isolated INTEGER DEFAULT 0");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE sync_configs ADD COLUMN isp TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE sources ADD COLUMN resolution TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE sync_configs ADD COLUMN aliasOnly INTEGER DEFAULT 0");
  } catch (e) {}

  // Clean up invalid Migu channels (Migu platform channel IDs must be numeric, like 631780532; cctv1, cctv2 belong to cntv)
  try {
    const invalidMigu = db.prepare("SELECT * FROM carousel_channels WHERE platform = 'migu'").all() as any[];
    for (const item of invalidMigu) {
      if (/^cctv|^cgtn/i.test(item.originalId)) {
        const cntvExists = db.prepare("SELECT id FROM carousel_channels WHERE platform = 'cntv' AND originalId = ?").get(item.originalId);
        if (cntvExists) {
          db.prepare("DELETE FROM carousel_channels WHERE id = ?").run(item.id);
        } else {
          db.prepare("UPDATE carousel_channels SET platform = 'cntv' WHERE id = ?").run(item.id);
        }
      } else if (!/^\d+$/.test(item.originalId)) {
        db.prepare("DELETE FROM carousel_channels WHERE id = ?").run(item.id);
      }
    }
  } catch (e) {
    console.error("Failed to clean up invalid migu carousel channels:", e);
  }

  // Seed default cron jobs if empty
  const hasCronJobs = db.prepare("SELECT COUNT(*) as count FROM cron_jobs").get() as { count: number };
  if (hasCronJobs.count === 0) {
    const insertCronJob = db.prepare(`
      INSERT INTO cron_jobs (id, name, startTime, intervalMinutes, active)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertCronJob.run("job_epg_sync", "EPG 自动同步", "02:00", 1440, 0);
    insertCronJob.run("job_github_import", "GitHub 源自动导入", "03:00", 1440, 0);
  }
  // Ensure job_server_test exists
  db.prepare(`
    INSERT OR IGNORE INTO cron_jobs (id, name, startTime, intervalMinutes, active)
    VALUES (?, ?, ?, ?, ?)
  `).run("job_server_test", "全网并发测速", "04:00", 1440, 0);

  // Ensure job_carousel_test exists
  db.prepare(`
    INSERT OR IGNORE INTO cron_jobs (id, name, startTime, intervalMinutes, active)
    VALUES (?, ?, ?, ?, ?)
  `).run("job_carousel_test", "轮播代理全网检测", "05:00", 1440, 0);

  dbInstance = db;
  return db;
}
