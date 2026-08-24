import express from "express";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// Ensure local time is interpreted as CST (UTC+8) by default if not specified
process.env.TZ = process.env.TZ || 'Asia/Shanghai';

import { createServer as createViteServer } from "vite";
import net from "net";
import { XMLParser } from "fast-xml-parser";
import zlib from "zlib";
import http from "http";
import https from "https";
import crypto from "crypto";
import { GoogleGenAI, Type } from "@google/genai";
import Database from "better-sqlite3";
import compression from "compression";

interface LiveSource {
  id: string;
  url: string;
  province: string;
  isp: string;
  status: "active" | "inactive" | "unknown" | "checking";
  latency?: number;
  resolution?: string;
  lastChecked?: string;
  clientIspReported?: string;
  clientProvinceReported?: string;
  isolated?: boolean;
  testCount?: number;
  successCount?: number;
}

interface Group {
  id: string;
  name: string;
  isolated?: boolean;
}

interface Channel {
  id: string;
  name: string;
  logo: string;
  groupIds: string[];
  alias: string[];
  epgId: string;
  sources: LiveSource[];
  isolated?: boolean;
}

interface SyncConfig {
  id: string;
  name: string;
  url: string;
  type: "m3u" | "txt";
  autoSync?: boolean;
  syncInterval?: number; // working in hours (e.g. 1, 6, 12, 24)
  lastSynced?: string;
  status: "success" | "failed" | "never";
  message?: string;
  disabled?: boolean;
  consecutiveFailures?: number;
  contentHash?: string;
  isp?: string;
  aliasOnly?: boolean;
}

interface EpgSource {
  id: string;
  name: string;
  url: string;
  active: boolean;
  lastSynced?: string;
  status: "success" | "failed" | "never";
  message?: string;
}

interface TestStatus {
  status: "idle" | "running";
  total: number;
  checked: number;
  lastDataUpdate?: number;
  results: {
    id: string;
    channelId: string;
    url: string;
    status: "active" | "inactive";
    latency?: number;
    resolution?: string;
  }[];
}

const DATA_DIR = process.env.DATA_DIR || (fs.existsSync("/data") ? "/data" : path.join(process.cwd(), "data"));
const DATA_FILE = path.join(DATA_DIR, "iptv_data.json");

// Ensure data folder exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-Memory Database State
let groups: Group[] = [];
let channels: Channel[] = [];
let syncConfigs: SyncConfig[] = [];
let epgSources: EpgSource[] = [];
let adminPassword = process.env.ADMIN_PASSWORD || "";
let githubProxy = "";
let autoCreateChannel = true;
let m3uLogoVersion = "";
let carouselProxyPresets = {
  "yy": [{"name":"开心麻花","id":"54880976"},{"name":"YY 官方","id":"12345"},{"name":"YY 舞蹈","id":"76"}],
  "douyu": [{"name":"开心麻花经典小品","id":"10153463"},{"name":"贾玲经典小品","id":"10419541"},{"name":"龙视开心麻花街","id":"9374862"},{"name":"英雄联盟","id":"9999"},{"name":"Dota2","id":"1126960"}],
  "huya": [{"name":"虎牙放映厅","id":"11602077"},{"name":"战争电影放映厅","id":"21059618"},{"name":"悬疑放映厅","id":"26355797"},{"name":"LPL赛事","id":"lpl"},{"name":"楚河","id":"116361"}],
  "bilibili": [{"name":"逍遥散人","id":"1129"},{"name":"官方赛事","id":"6"}],
  "kuaishou": [{"name":"王者荣耀","id":"kpl"},{"name":"快手精选","id":"3x876g5g6f7"}],
  "douyin": [{"name":"抖音直播精选","id":"123456"}],
  "cntv": [{"name":"CCTV-1 综合","id":"cctv1"},{"name":"CCTV-5 体育","id":"cctv5"}],
  "migu": [{"name":"咪咕赛事","id":"608807420"}],
  "iptv": [{"name":"IPTV 直播","id":"live"}]
};
export interface IpGeoApi {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  failCount?: number;
}

let ipGeoApis: IpGeoApi[] = [
  { id: "ip-api", name: "ip-api.com", url: "http://ip-api.com/json/{{ip}}?lang=zh-CN", enabled: true },
  { id: "pconline", name: "太平洋电脑网", url: "https://whois.pconline.com.cn/ipJson.jsp?ip={{ip}}&json=true", enabled: true }
];
let autoSwitchGeoApi = true;


const SQLITE_DB_PATH = path.join(DATA_DIR, "iptv_sqlite.db");
let db: Database.Database;

function initSqlite() {
  db = new Database(SQLITE_DB_PATH);
  
  // Enable WAL mode for high performance concurrency and stability
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  // Create tables structured for fast access
  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      logo TEXT,
      groupIds TEXT,
      alias TEXT,
      epgId TEXT
    );
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      channelId TEXT NOT NULL,
      url TEXT NOT NULL,
      province TEXT,
      isp TEXT,
      status TEXT,
      latency INTEGER,
      lastChecked TEXT,
      clientIspReported TEXT,
      clientProvinceReported TEXT
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
  `);

  
  // Ensure optimized indices for speedy lookups
  db.exec(`
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
  } catch (e) {
    // Column already exists
  }

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

  // Clean up any invalid proxy templates and obsolete discovery rules
  try {
    db.prepare("DELETE FROM carousel_proxies WHERE urlTemplate LIKE '%miguvideo%' OR urlTemplate LIKE '%lz-cdn%' OR urlTemplate LIKE '%lzcdn%' OR urlTemplate LIKE '%/202%' OR urlTemplate LIKE '%/203%'").run();
    db.prepare("DELETE FROM carousel_discovery_rules WHERE platform = 'cntv' OR keyword = 'yy.m3u8' OR keyword LIKE 'regex:^https?://%'").run();
    seedKnownRules(false);
    cleanupBlockedCarouselProxies();
  } catch (e) {}

  // One-time initialization for carousel discovery rules
  try {
    const isRulesInit = db.prepare("SELECT value FROM system_settings WHERE key = 'carousel_rules_initialized'").get() as any;
    if (!isRulesInit) {
      const rulesCount = (db.prepare('SELECT COUNT(*) as count FROM carousel_discovery_rules').get() as any).count;
      if (rulesCount === 0) {
        seedKnownRules(false);
      }
      db.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('carousel_rules_initialized', 'true')").run();
    }
  } catch (e) {
    // ignore
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
  try {
    db.exec("ALTER TABLE sync_configs ADD COLUMN aliasOnly INTEGER DEFAULT 0");
  } catch (e) {}

  // Seed default cron jobs if empty
  const hasCronJobs = db.prepare("SELECT COUNT(*) as count FROM cron_jobs").get() as { count: number };
  if (hasCronJobs.count === 0) {
    const insertCronJob = db.prepare(`
      INSERT INTO cron_jobs (id, name, startTime, intervalMinutes, active)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertCronJob.run("job_epg_sync", "EPG 自动同步", "02:00", 1440, 0); // default inactive, daily at 2AM
    insertCronJob.run("job_github_import", "GitHub 源自动导入", "03:00", 1440, 0); // default inactive, daily at 3AM
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
}

const EPG_CACHE_DIR = path.join(DATA_DIR, "epg_cache_sources");
if (!fs.existsSync(EPG_CACHE_DIR)) {
  fs.mkdirSync(EPG_CACHE_DIR, { recursive: true });
}

interface EpgEntry {
  displayNames: string[];
  programs: { start: string; stop: string; title: string; desc: string }[];
}

interface EpgCacheIndexed {
  raw: Record<string, EpgEntry>;
  idMap: Map<string, EpgEntry>;
  nameMap: Map<string, EpgEntry>;
}

// Disk cache paths for exported EPG feeds
const EPG_EXPORT_XML_PATH = path.join(DATA_DIR, "epg_export.xml");
const EPG_EXPORT_GZ_PATH = path.join(DATA_DIR, "epg_export.xml.gz");

// In-Memory cache for loaded EPG configurations to avoid reading from disk on every route hit
const loadedEpgCaches: Record<string, EpgCacheIndexed> = {};

let integratedEpgXmlCache: string | null = null;
let integratedEpgXmlGzCache: Buffer | null = null;
let integratedEpgCacheTime = 0;
let integratedEpgEtag = "";

function invalidateIntegratedEpgCache() {
  integratedEpgXmlCache = null;
  integratedEpgXmlGzCache = null;
  integratedEpgCacheTime = 0;
  integratedEpgEtag = "";
  try {
    if (fs.existsSync(EPG_EXPORT_XML_PATH)) fs.unlinkSync(EPG_EXPORT_XML_PATH);
    if (fs.existsSync(EPG_EXPORT_GZ_PATH)) fs.unlinkSync(EPG_EXPORT_GZ_PATH);
  } catch (_) {}
}

// Disk cache path & memory cache for exported Playlists (M3U / TXT) by ISP, Province, Category & Params
const PLAYLIST_CACHE_DIR = path.join(DATA_DIR, "playlist_cache");
if (!fs.existsSync(PLAYLIST_CACHE_DIR)) {
  fs.mkdirSync(PLAYLIST_CACHE_DIR, { recursive: true });
}

interface ExportPlaylistCacheItem {
  content: string;
  etag: string;
  mtimeMs: number;
}

const exportPlaylistMemoryCache = new Map<string, ExportPlaylistCacheItem>();

function invalidatePlaylistExportCache() {
  exportPlaylistMemoryCache.clear();
  try {
    if (fs.existsSync(PLAYLIST_CACHE_DIR)) {
      const files = fs.readdirSync(PLAYLIST_CACHE_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(PLAYLIST_CACHE_DIR, file));
      }
    }
  } catch (_) {}
}

function getPlaylistCacheKey(params: {
  format: string;
  category?: string;
  isp?: string;
  province?: string;
  status?: string;
  limit?: string | number;
  maxPerChannel?: string | number;
  baseUrl?: string;
  v?: string;
}): string {
  const rawKey = [
    params.format || "m3u",
    params.category || "",
    params.isp || "",
    params.province || "",
    params.status || "",
    params.limit || "",
    params.maxPerChannel || "",
    params.baseUrl || "",
    params.v || ""
  ].join("|");
  return crypto.createHash("md5").update(rawKey).digest("hex");
}

function getOrGeneratePlaylistExport(
  params: {
    format: "m3u" | "txt";
    category?: string;
    isp?: string;
    province?: string;
    status?: string;
    limit?: string | number;
    maxPerChannel?: string | number;
    baseUrl?: string;
    v?: string;
  },
  generatorFn: () => string
): { content: string; etag: string } {
  const cacheKey = getPlaylistCacheKey(params);
  const now = Date.now();

  // 1. Check in-memory cache (No TTL)
  const memItem = exportPlaylistMemoryCache.get(cacheKey);
  if (memItem) {
    return { content: memItem.content, etag: memItem.etag };
  }

  // 2. Check disk file cache (No TTL)
  const ext = params.format === "m3u" ? ".m3u" : ".txt";
  const filePath = path.join(PLAYLIST_CACHE_DIR, `${cacheKey}${ext}`);

  try {
    if (!fs.existsSync(PLAYLIST_CACHE_DIR)) {
      fs.mkdirSync(PLAYLIST_CACHE_DIR, { recursive: true });
    }
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      const content = fs.readFileSync(filePath, "utf-8");
      const etag = `W/"pl-${cacheKey.slice(0, 8)}-${Math.floor(stats.mtimeMs)}-${content.length}"`;
      exportPlaylistMemoryCache.set(cacheKey, { content, etag, mtimeMs: stats.mtimeMs });
      return { content, etag };
    }
  } catch (e) {
    console.warn("[PLAYLIST DISK CACHE LOAD WARN]", e);
  }

  // 3. Generate content on cache miss
  const content = generatorFn();
  const etag = `W/"pl-${cacheKey.slice(0, 8)}-${now}-${content.length}"`;

  exportPlaylistMemoryCache.set(cacheKey, { content, etag, mtimeMs: now });

  try {
    if (!fs.existsSync(PLAYLIST_CACHE_DIR)) {
      fs.mkdirSync(PLAYLIST_CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(filePath, content, "utf-8");

    // Save human readable copy to data/playlists_export
    const READABLE_DIR = path.join(DATA_DIR, "playlists_export");
    if (!fs.existsSync(READABLE_DIR)) {
      fs.mkdirSync(READABLE_DIR, { recursive: true });
    }
    const parts: string[] = [params.format || "m3u"];
    if (params.category) parts.push(params.category);
    if (params.isp) parts.push(params.isp);
    if (params.province) parts.push(params.province);
    if (params.status) parts.push(`status_${params.status}`);
    const humanName = (parts.length > 1 ? parts.join("_") : parts[0] + "_all") + (params.format === "txt" ? ".txt" : ".m3u");
    fs.writeFileSync(path.join(READABLE_DIR, humanName.replace(/[<>:"/\\|?*]+/g, "_")), content, "utf-8");
  } catch (err) {
    console.error("[PLAYLIST DISK CACHE WRITE ERROR]", err);
  }

  return { content, etag };
}
const testStatus: TestStatus = {
  status: "idle",
  total: 0,
  checked: 0,
  results: [],
};

// Strip bitrate and resolution details from channel names (e.g. CCTV13 4M1080 -> CCTV13, iHot爱青春 7.5M1080 -> iHot爱青春)
// Auto-detect and register carousel proxy from URL
  // --- Carousel Discovery Rules API ---
  const PRESET_KNOWN_RULES = [
    // YY 直播
    { platform: 'yy', keyword: '/yy/' },
    { platform: 'yy', keyword: 'yy.php' },
    { platform: 'yy', keyword: '/yy.php' },
    { platform: 'yy', keyword: 'yy.flv' },

    // 斗鱼直播
    { platform: 'douyu', keyword: '/douyu/' },
    { platform: 'douyu', keyword: 'douyu.php' },
    { platform: 'douyu', keyword: 'dy.php' },
    { platform: 'douyu', keyword: '/dy/' },

    // 虎牙直播
    { platform: 'huya', keyword: '/huya/' },
    { platform: 'huya', keyword: 'huya.php' },
    { platform: 'huya', keyword: '/huya.php' },
    { platform: 'huya', keyword: 'hy.php' },

    // B站 (Bilibili)
    { platform: 'bilibili', keyword: '/bilibili/' },
    { platform: 'bilibili', keyword: 'bilibili.php' },
    { platform: 'bilibili', keyword: '/bili/' },
    { platform: 'bilibili', keyword: 'bili.php' },

    // 快手直播
    { platform: 'kuaishou', keyword: '/kuaishou/' },
    { platform: 'kuaishou', keyword: 'kuaishou.php' },
    { platform: 'kuaishou', keyword: 'ks.php' },

    // 抖音直播
    { platform: 'douyin', keyword: '/douyin/' },
    { platform: 'douyin', keyword: 'douyin.php' },
    { platform: 'douyin', keyword: 'dyin.php' },

    // 咪咕
    { platform: 'migu', keyword: '/migu/' },
    { platform: 'migu', keyword: '/migu?' },
    { platform: 'migu', keyword: 'migu.php' },
    { platform: 'migu', keyword: '/migu_live/' },
    { platform: 'migu', keyword: '/mg/' },
    { platform: 'migu', keyword: 'mg.php' },
    { platform: 'migu', keyword: 'regex:[?&]platform=migu' },
    { platform: 'migu', keyword: 'regex::\\d+/(?:migu|mg)/\\d+' },
    { platform: 'migu', keyword: 'regex::\\d+/[1-9]\\d{7,9}(?!\\d)(?:/|\\?|\\.|#|$)' }
  ];

  let discoveryRulesCache: any[] | null = null;
  let disabledRulesCache: any[] | null = null;

  const PRESET_DISABLED_RULES = [
    {
      pattern: "miguvideo",
      type: "contains",
      platform: "",
      description: "忽略咪咕官方直链与CDN流 (miguvideo.com)",
      enabled: 1
    },
    {
      pattern: "hw-mbl-live.miguvideo.com",
      type: "domain",
      platform: "migu",
      description: "忽略咪咕华为移动直播CDN域名",
      enabled: 1
    },
    {
      pattern: "play.miguvideo.com",
      type: "domain",
      platform: "migu",
      description: "忽略咪咕播放CDN域名",
      enabled: 1
    },
    {
      pattern: "aliyuncs.com",
      type: "contains",
      platform: "",
      description: "忽略阿里云官方点播/直链流",
      enabled: 0
    },
    {
      pattern: "douyucdn.cn",
      type: "domain",
      platform: "douyu",
      description: "忽略斗鱼官方CDN临时直链",
      enabled: 0
    }
  ];

  function seedDisabledRules(overwrite = false) {
    if (overwrite) {
      db.prepare('DELETE FROM carousel_disabled_rules').run();
    }
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO carousel_disabled_rules (id, pattern, type, platform, description, enabled)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertMany = db.transaction((rules) => {
      let count = 0;
      for (const rule of rules) {
        const info = insertStmt.run(
          crypto.randomUUID(),
          rule.pattern,
          rule.type || 'contains',
          rule.platform || '',
          rule.description || '',
          rule.enabled !== undefined ? (rule.enabled ? 1 : 0) : 1
        );
        if (info.changes > 0) count++;
      }
      return count;
    });
    const added = insertMany(PRESET_DISABLED_RULES);
    disabledRulesCache = null;
    return added;
  }

  function getDisabledRules() {
    if (!disabledRulesCache) {
      const count = (db.prepare('SELECT COUNT(*) as count FROM carousel_disabled_rules').get() as any).count;
      if (count === 0) {
        seedDisabledRules(false);
      }
      disabledRulesCache = db.prepare('SELECT * FROM carousel_disabled_rules ORDER BY createdAt DESC').all() as any[];
    }
    return disabledRulesCache;
  }

  function isUrlBlockedByDisabledRules(url: string, platform?: string): boolean {
    if (!url || typeof url !== 'string') return true;
    const urlLower = url.toLowerCase();

    // Always block miguvideo as core hard rule
    if (urlLower.includes("miguvideo")) return true;

    try {
      const rules = getDisabledRules();
      for (const rule of rules) {
        if (rule.enabled !== 1 && rule.enabled !== true) continue;
        if (rule.platform && platform && rule.platform.toLowerCase() !== platform.toLowerCase()) {
          continue;
        }
        const pat = (rule.pattern || '').trim();
        if (!pat) continue;
        const patLower = pat.toLowerCase();

        if (rule.type === 'regex') {
          try {
            const reg = new RegExp(pat, 'i');
            if (reg.test(url)) return true;
          } catch (e) {}
        } else if (rule.type === 'prefix') {
          if (urlLower.startsWith(patLower)) return true;
        } else if (rule.type === 'domain') {
          try {
            let host = "";
            if (url.startsWith("http://") || url.startsWith("https://")) {
              host = new URL(url).hostname.toLowerCase();
            } else {
              host = url.split("/")[0].split(":")[0].toLowerCase();
            }
            if (host === patLower || host.endsWith("." + patLower) || host.includes(patLower)) {
              return true;
            }
          } catch (e) {
            if (urlLower.includes(patLower)) return true;
          }
        } else {
          // contains
          if (urlLower.includes(patLower)) return true;
        }
      }
    } catch (e) {
      // fallback
    }

    return false;
  }

  function cleanupBlockedCarouselProxies(): number {
    let count = 0;
    try {
      const resMigu = db.prepare(`
        DELETE FROM carousel_proxies 
        WHERE urlTemplate LIKE '%miguvideo%' 
           OR urlTemplate LIKE '%lz-cdn%' 
           OR urlTemplate LIKE '%lzcdn%' 
           OR urlTemplate LIKE '%ffzy%' 
           OR urlTemplate LIKE '%bfzy%'
           OR urlTemplate LIKE '%/202%'
           OR urlTemplate LIKE '%/203%'
      `).run();
      count += resMigu.changes;

      const allProxies = db.prepare('SELECT id, platform, urlTemplate FROM carousel_proxies').all() as any[];
      for (const p of allProxies) {
        if (isUrlBlockedByDisabledRules(p.urlTemplate, p.platform)) {
          const r = db.prepare('DELETE FROM carousel_proxies WHERE id = ?').run(p.id);
          count += r.changes;
        }
      }
    } catch (e) {
      console.error("Failed to cleanup blocked carousel proxies:", e);
    }
    return count;
  }

  function seedKnownRules(overwrite = false) {
    if (overwrite) {
      db.prepare('DELETE FROM carousel_discovery_rules').run();
    } else {
      // Clean up removed rules (cntv, yy.m3u8) or overly loose domain regex rules
      db.prepare("DELETE FROM carousel_discovery_rules WHERE platform = 'cntv' OR keyword = 'yy.m3u8' OR keyword LIKE 'regex:^https?://%'").run();
    }
    const insertStmt = db.prepare('INSERT OR IGNORE INTO carousel_discovery_rules (id, platform, keyword, enabled) VALUES (?, ?, ?, 1)');
    const insertMany = db.transaction((rules) => {
      let count = 0;
      for (const rule of rules) {
        const info = insertStmt.run(crypto.randomUUID(), rule.platform, rule.keyword);
        if (info.changes > 0) count++;
      }
      return count;
    });
    const addedCount = insertMany(PRESET_KNOWN_RULES);
    discoveryRulesCache = null;
    return addedCount;
  }

  function getDiscoveryRules(includeDisabled = false) {
    if (!discoveryRulesCache) {
      try {
        discoveryRulesCache = db.prepare('SELECT * FROM carousel_discovery_rules').all();
      } catch (e) {
        discoveryRulesCache = [];
      }
    }
    if (includeDisabled) {
      return discoveryRulesCache || [];
    }
    return (discoveryRulesCache || []).filter((r: any) => r.enabled === 1 || r.enabled === true || r.enabled === undefined || r.enabled === null);
  }

// Helper to parse carousel platform and ID

function removeSourcesForProxyTemplates(templates: { platform?: string; urlTemplate: string }[]) {
  if (!templates || templates.length === 0) return 0;
  let removedCount = 0;
  
  for (const t of templates) {
    if (!t || !t.urlTemplate) continue;
    const parts = t.urlTemplate.split('{}');
    const prefix = parts[0];
    const suffix = parts[1] !== undefined ? parts[1] : '';

    // 1. Remove from in-memory channels
    for (const ch of channels) {
      if (ch.sources && ch.sources.length > 0) {
        const initLen = ch.sources.length;
        ch.sources = ch.sources.filter((s: any) => {
          if (!s || !s.url) return true;
          if (suffix) {
            if (s.url.startsWith(prefix) && s.url.endsWith(suffix)) return false;
          } else {
            if (s.url.startsWith(prefix)) return false;
          }
          return true;
        });
        removedCount += (initLen - ch.sources.length);
      }
    }

    // 2. Remove from SQLite sources table
    try {
      if (suffix) {
        const res = db.prepare("DELETE FROM sources WHERE url LIKE ? AND url LIKE ?").run(`${prefix}%`, `%${suffix}`);
        removedCount += res.changes;
      } else {
        const res = db.prepare("DELETE FROM sources WHERE url LIKE ?").run(`${prefix}%`);
        removedCount += res.changes;
      }
    } catch (e) {
      console.error("Error deleting sources from SQLite for proxy template:", e);
    }
  }

  saveData(true);
  return removedCount;
}

async function testCarouselProxyAvailability(proxy: { platform: string; urlTemplate: string }, timeoutMs = 6000): Promise<{ available: boolean; latency: number | null; error?: string }> {
  try {
    const plat = (proxy.platform || '').toLowerCase();
    const fallbacks: Record<string, string[]> = {
      "yy": ["54880976", "12345", "76"],
      "douyu": ["10153463", "10419541", "9374862", "9999"],
      "huya": ["11602077", "21059618", "26355797", "lpl"],
      "bilibili": ["1129", "6", "102"],
      "kuaishou": ["3x876g5g6f7", "kpl"],
      "douyin": ["123456"],
      "cntv": ["cctv1", "cctv5"],
      "migu": ["608807420"],
      "iptv": ["live"]
    };
    
    // Collect candidate test IDs: registered channels > preset IDs > fallbacks
    const candidateIds: string[] = [];
    try {
      const regList = db.prepare('SELECT originalId FROM carousel_channels WHERE LOWER(platform) = ? LIMIT 5').all(plat) as any[];
      for (const r of regList) {
        if (r.originalId && !candidateIds.includes(r.originalId)) {
          candidateIds.push(r.originalId);
        }
      }
    } catch (e) {}

    const presetList = (carouselProxyPresets as any)?.[plat] || [];
    for (const p of presetList) {
      if (p.id && !candidateIds.includes(p.id)) {
        candidateIds.push(p.id);
      }
    }

    const fallbackList = fallbacks[plat] || ["12345"];
    for (const fb of fallbackList) {
      if (!candidateIds.includes(fb)) {
        candidateIds.push(fb);
      }
    }

    // Try up to 3 candidate IDs in sequence
    let lastError = "";
    const testCandidates = candidateIds.slice(0, 3);

    for (const testId of testCandidates) {
      const testUrl = proxy.urlTemplate.replace('{}', testId);
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        const start = Date.now();
        
        const response = await fetch(testUrl, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*'
          }
        });
        clearTimeout(timeoutId);
        const latency = Date.now() - start;

        // Any 2xx or 3xx (redirect to stream CDN) is considered valid
        if (response.ok || (response.status >= 200 && response.status < 400)) {
          return { available: true, latency };
        } else {
          lastError = `HTTP 响应状态 ${response.status} ${response.statusText || ''}`.trim();
        }
      } catch (e: any) {
        const isTimeout = e?.name === 'AbortError' || e?.message?.includes('aborted');
        lastError = isTimeout ? `连接超时 (${Math.round(timeoutMs/1000)}秒未响应)` : (e?.message || '网络连接异常');
      }
    }

    return { available: false, latency: null, error: lastError || '未获取到有效流媒体响应' };
  } catch (e: any) {
    return { available: false, latency: null, error: e?.message || '测活异常' };
  }
}

function syncCarouselSources(): { createdCount: number; updatedCount: number; totalCount: number; channelsCount: number; activeProxiesCount: number; totalProxiesCount: number } {
  let createdCount = 0;
  let updatedCount = 0;
  let totalCount = 0;

  const allProxies = db.prepare("SELECT * FROM carousel_proxies").all() as any[];
  const carouselChannels = db.prepare("SELECT * FROM carousel_channels").all() as any[];
  const enabledDiscoveryRules = getDiscoveryRules(false);
  const enabledPlatforms = new Set(enabledDiscoveryRules.map((r: any) => (r.platform || '').toLowerCase()));
  const hasDiscoveryRules = (db.prepare('SELECT COUNT(*) as count FROM carousel_discovery_rules').get() as any).count > 0;

  // Make sure '轮播频道' group exists
  let carouselGroup = groups.find(g => g.name === "轮播频道");
  if (!carouselGroup) {
    carouselGroup = {
      id: "g_carousel",
      name: "轮播频道"
    };
    groups.push(carouselGroup);
    try {
      const gExists = db.prepare("SELECT id FROM groups WHERE id = ?").get(carouselGroup.id);
      if (!gExists) {
        db.prepare("INSERT INTO groups (id, name) VALUES (?, ?)").run(carouselGroup.id, carouselGroup.name);
      }
    } catch (e) {}
  }

  const processedChannelIds = new Set<string>();

  for (const cc of carouselChannels) {
    if (!cc.name || !cc.platform || !cc.originalId) continue;
    const plat = (cc.platform || '').toLowerCase();
    const isPlatformDisabled = hasDiscoveryRules && !enabledPlatforms.has(plat);

    let dbChannel = db.prepare("SELECT * FROM channels WHERE id = ?").get(cc.channelId) as any;
    if (!dbChannel && cc.name) {
      dbChannel = db.prepare("SELECT * FROM channels WHERE name = ?").get(cc.name) as any;
      if (dbChannel) {
        db.prepare("UPDATE carousel_channels SET channelId = ? WHERE id = ?").run(dbChannel.id, cc.id);
      }
    }
    if (!dbChannel) {
      const nid = crypto.randomUUID();
      const defaultGroupIds = JSON.stringify([carouselGroup.id]);
      dbChannel = { id: nid, name: cc.name, groupIds: defaultGroupIds, alias: '[]', logo: '', epgId: '' };
      db.prepare("INSERT INTO channels (id, name, logo, groupIds, alias, epgId) VALUES (?, ?, ?, ?, ?, ?)").run(
        dbChannel.id, dbChannel.name, dbChannel.logo, dbChannel.groupIds, dbChannel.alias, dbChannel.epgId
      );
      db.prepare("UPDATE carousel_channels SET channelId = ? WHERE id = ?").run(dbChannel.id, cc.id);
    } else {
      try {
        let gIds = JSON.parse(dbChannel.groupIds || "[]");
        if (!Array.isArray(gIds) || gIds.length === 0) {
          gIds = [carouselGroup.id];
          db.prepare("UPDATE channels SET groupIds = ? WHERE id = ?").run(JSON.stringify(gIds), dbChannel.id);
        }
      } catch (e) {}
    }

    processedChannelIds.add(dbChannel.id);

    const matchingProxies = allProxies.filter(p => (p.platform || '').toLowerCase() === plat);

    for (const proxy of matchingProxies) {
      const targetUrl = proxy.urlTemplate.replace(/\{\s*(?:id|roomid|channelid|cid|originalid)?\s*\}/gi, cc.originalId);
      const isBlocked = isPlatformDisabled || isUrlBlockedByDisabledRules(proxy.urlTemplate, proxy.platform);
      
      if (proxy.status === 'active' && !isBlocked) {
        const exists = db.prepare("SELECT id FROM sources WHERE channelId = ? AND url = ?").get(dbChannel.id, targetUrl);
        if (!exists) {
          db.prepare("INSERT INTO sources (id, channelId, url, province, isp, status) VALUES (?, ?, ?, ?, ?, ?)").run(
            crypto.randomUUID(), dbChannel.id, targetUrl, '', '', 'active'
          );
          createdCount++;
        }
        totalCount++;
      } else {
        // Remove from SQLite sources
        db.prepare("DELETE FROM sources WHERE channelId = ? AND url = ?").run(dbChannel.id, targetUrl);
      }
    }
  }

  // Also migrate any other existing sources in the DB that match registry mapping to the proper channelId
  const regMap = new Map();
  for (const r of carouselChannels) {
    if (r.platform && r.originalId) {
      regMap.set(`${(r.platform || '').toLowerCase()}_${r.originalId}`, r);
    }
  }

  const allSources = db.prepare(`
    SELECT s.* 
    FROM sources s 
    LEFT JOIN channels c ON s.channelId = c.id 
    WHERE (s.isolated = 0 OR s.isolated IS NULL) 
      AND (c.isolated = 0 OR c.isolated IS NULL)
  `).all() as any[];

  for (const source of allSources) {
    if (!source.url) continue;
    const parsed = parseCarouselUrl(source.url);
    if (parsed.platform && parsed.originalId) {
      const key = `${(parsed.platform || '').toLowerCase()}_${parsed.originalId}`;
      const registry = regMap.get(key);
      if (registry) {
        let targetChannel = db.prepare('SELECT * FROM channels WHERE id = ?').get(registry.channelId) as any;
        if (!targetChannel && registry.name) {
          targetChannel = db.prepare('SELECT * FROM channels WHERE name = ?').get(registry.name) as any;
        }
        if (targetChannel && source.channelId !== targetChannel.id) {
          db.prepare('UPDATE sources SET channelId = ? WHERE id = ?').run(targetChannel.id, source.id);
          updatedCount++;
        }
      }
    }
  }

  // Cleanup empty channels (excluding registered channels)
  db.exec("DELETE FROM channels WHERE id NOT IN (SELECT DISTINCT channelId FROM sources) AND id NOT IN (SELECT DISTINCT channelId FROM carousel_channels)");

  // Reload memory state directly from SQLite
  loadData();
  saveDataSync();

  const activeProxiesCount = allProxies.filter(p => p.status === 'active' && !isUrlBlockedByDisabledRules(p.urlTemplate, p.platform)).length;

  return {
    createdCount,
    updatedCount,
    totalCount,
    channelsCount: processedChannelIds.size,
    activeProxiesCount,
    totalProxiesCount: allProxies.length
  };
}

function matchesRuleKeyword(url: string, keyword: string, platform?: string): boolean {
  if (!url || !keyword) return false;
  
  // Exclude all URLs matched by disabled discovery rules
  if (isUrlBlockedByDisabledRules(url, platform)) {
    return false;
  }

  if (keyword.startsWith("regex:") || keyword.includes("\\d") || keyword.includes(".*") || keyword.includes("[") || keyword.includes("^") || keyword.includes("$")) {
    try {
      const pattern = keyword.startsWith("regex:") ? keyword.slice(6) : keyword;
      return new RegExp(pattern, "i").test(url);
    } catch (e) {
      // fallback
    }
  }
  return url.includes(keyword);
}

function extractCarouselPlatformAndId(url: string): { platform: string | null; originalId: string | null; template: string | null } {
  if (!url || typeof url !== 'string') return { platform: null, originalId: null, template: null };

  // Exclude all URLs matched by disabled discovery rules
  if (isUrlBlockedByDisabledRules(url)) {
    return { platform: null, originalId: null, template: null };
  }

  let platform: string | null = null;
  const rules = typeof getDiscoveryRules === 'function' ? getDiscoveryRules(false) : [];
  for (const rule of rules) {
    if (matchesRuleKeyword(url, rule.keyword, rule.platform)) {
      platform = rule.platform;
      break;
    }
  }

  // Heuristic fallbacks if no custom rule matched (do not include IPTV as it belongs to general TV streams)
  if (!platform) {
    if (/[?&/](?:migu|mg)[_./?]/i.test(url) || /\/migu\b/i.test(url) || /migu\.php/i.test(url)) {
      platform = "migu";
    } else if (/[?&/](?:yy)[_./?]/i.test(url) || /yy\.php/i.test(url)) {
      platform = "yy";
    } else if (/[?&/](?:douyu)[_./?]/i.test(url) || /douyu\.php/i.test(url)) {
      platform = "douyu";
    } else if (/[?&/](?:huya)[_./?]/i.test(url) || /huya\.php/i.test(url)) {
      platform = "huya";
    } else if (/[?&/](?:bilibili|bili)[_./?]/i.test(url) || /bilibili\.php/i.test(url)) {
      platform = "bilibili";
    } else if (/[?&/](?:kuaishou|ks)[_./?]/i.test(url) || /kuaishou\.php/i.test(url)) {
      platform = "kuaishou";
    } else if (/[?&/](?:douyin|dyin)[_./?]/i.test(url) || /douyin\.php/i.test(url)) {
      platform = "douyin";
    } else if (/[?&/](?:cntv)[_./?]/i.test(url) || /cntv\.php/i.test(url)) {
      platform = "cntv";
    }
  }

  if (!platform) return { platform: null, originalId: null, template: null };

  let originalId: string | null = null;
  let template: string | null = null;

  if (platform === 'migu') {
    // 1. Query parameter ?id=631780532
    const qMatch = url.match(/[?&](?:id|cid|rid|channelId|roomId)=(\d{6,12})/i);
    if (qMatch) {
      originalId = qMatch[1];
      template = url.replace(new RegExp(`([?&](?:id|cid|rid|channelId|roomId)=)${originalId}`, 'i'), '$1{}');
    }

    // 2. Path matching with /migu/ or /mg/: e.g. /migu/631780532/1.m3u8, /migu/631780532.m3u8, /migu/631780532
    if (!originalId) {
      const pathMatch = url.match(/\/(?:migu|mg|migu_live)\/(\d{6,12})(?:(?:\/|\.m3u8|\.flv)[^?#]*)?(?:\?.*)?$/i);
      if (pathMatch) {
        originalId = pathMatch[1];
        template = url.replace(new RegExp(`(/+(?:migu|mg|migu_live)/+)${originalId}`, 'i'), '$1{}');
      }
    }

    // 3. Port-level proxy: http://ip:port/631780532, http://ip:port/708807420
    if (!originalId) {
      const rootMatch = url.match(/:\d+\/+([1-9]\d{7,9})(?:(?:\/|\.m3u8|\.flv)[^?#]*)?(?:\?.*)?$/i);
      if (rootMatch) {
        originalId = rootMatch[1];
        template = url.replace(new RegExp(`(:\\d+/+)${originalId}`, 'i'), '$1{}');
      }
    }

    // 4. Fallback numeric id (8 to 10 digits) - ONLY if URL explicitly contains migu/mg keyword
    if (!originalId && /[?&/](?:migu|mg)[_./?]/i.test(url)) {
      const numMatch = url.match(/\b([1-9]\d{7,9})\b/);
      if (numMatch) {
        originalId = numMatch[1];
        template = url.replace(originalId, '{}');
      }
    }

    if (originalId) {
      if (/^cctv|^cgtn/i.test(originalId)) {
        platform = 'cntv';
      } else if (!/^\d{6,12}$/.test(originalId)) {
        platform = null;
        originalId = null;
        template = null;
      }
    } else {
      platform = null;
    }
  } else {
    // Other platforms
    const match1 = url.match(/[?&](?:id|cid|rid|channelId|roomId)=([a-zA-Z0-9_-]+)/i);
    if (match1) {
      originalId = match1[1];
      template = url.replace(new RegExp(`([?&](?:id|cid|rid|channelId|roomId)=)${originalId}`, 'i'), '$1{}');
    }

    if (!originalId) {
      const match2 = url.match(/\/(?:yy|douyu|huya|bilibili|bili|kuaishou|ks|douyin|cntv)\/([a-zA-Z0-9_-]+)(?:(?:\/|\.m3u8|\.flv)[^?#]*)?(?:\?.*)?$/i);
      if (match2) {
        originalId = match2[1];
        template = url.replace(new RegExp(`(/+(?:yy|douyu|huya|bilibili|bili|kuaishou|ks|douyin|cntv)/+)${originalId}`, 'i'), '$1{}');
      }
    }

    if (!originalId) {
      const match3 = url.match(/\/([a-zA-Z0-9_-]+)(?:\.flv|\.m3u8)?(?:\?.*)?\/?$/i);
      if (match3 && match3[1] && !/^(?:index|live|playlist|video|chunk|stream|stream\d+|1|\d)$/i.test(match3[1])) {
        originalId = match3[1];
        template = url.replace(new RegExp(`(/+)${originalId}(?=[/.?#]|$)`, 'i'), '$1{}');
      }
    }
  }

  if (template && !template.includes('{}')) {
    template = null;
  }

  return { platform, originalId, template };
}

function parseCarouselUrl(url: string) {
  const { platform, originalId } = extractCarouselPlatformAndId(url);
  return { platform, originalId };
}

function detectAndRegisterCarouselProxy(url: string, ignoreDeletedCheck = false) {
  try {
    if (!url || typeof url !== 'string') return;
    if (isUrlBlockedByDisabledRules(url)) return;
    const { platform, template } = extractCarouselPlatformAndId(url);

    if (platform && template && template.includes('{}') && !isUrlBlockedByDisabledRules(template, platform)) {
      // Check if user has explicitly deleted this proxy template
      if (!ignoreDeletedCheck) {
        try {
          const isDeleted = db.prepare('SELECT 1 FROM deleted_carousel_proxies WHERE urlTemplate = ?').get(template);
          if (isDeleted) return;
        } catch (e) {}
      } else {
        try {
          db.prepare('DELETE FROM deleted_carousel_proxies WHERE urlTemplate = ?').run(template);
        } catch (e) {}
      }

      const exists = db.prepare('SELECT id FROM carousel_proxies WHERE urlTemplate = ?').get(template);
      if (!exists) {
        db.prepare('INSERT INTO carousel_proxies (id, platform, urlTemplate, status) VALUES (?, ?, ?, ?)').run(
          crypto.randomUUID(),
          platform,
          template,
          'active'
        );
      }
    }
  } catch (e) {
    console.error('Error detecting carousel proxy:', e);
  }
}

function scanAndRegisterAllCarouselProxies(forceReScan = false): number {
  try {
    cleanupBlockedCarouselProxies();
    if (forceReScan) {
      try {
        db.prepare('DELETE FROM deleted_carousel_proxies').run();
      } catch (e) {}
    }
    let addedCount = 0;
    // Exclude isolated sources and sources belonging to isolated channels
    const allSources = db.prepare(`
      SELECT s.url 
      FROM sources s 
      LEFT JOIN channels c ON s.channelId = c.id 
      WHERE (s.isolated = 0 OR s.isolated IS NULL) 
        AND (c.isolated = 0 OR c.isolated IS NULL)
    `).all() as any[];
    for (const row of allSources) {
      if (row.url && !isUrlBlockedByDisabledRules(row.url)) {
        const prevCount = (db.prepare('SELECT COUNT(*) as count FROM carousel_proxies').get() as any).count;
        detectAndRegisterCarouselProxy(row.url, forceReScan);
        const newCount = (db.prepare('SELECT COUNT(*) as count FROM carousel_proxies').get() as any).count;
        if (newCount > prevCount) {
          addedCount += (newCount - prevCount);
        }
      }
    }
    return addedCount;
  } catch (e) {
    console.error('Error scanning carousel proxies from sources:', e);
    return 0;
  }
}

function stripBitrateAndResolution(name: string): string {
  if (!name) return "";
  let clean = name.trim();

  // Remove common Chinese/English quality tags optionally appended mid-string or at the end
  // Preserve 4K, 8K, and 超高清 as they distinguish dedicated ultra-high-definition channels
  clean = clean.replace(/(?:\s+|-|_)*(?:(?<!超)高清|超清(?!高)|标清|蓝光|原画|1080[pPiI]|720[pPiI]|576[pPiI]|480[pPiI]|HEVC|hevc|H265|h265|H264|h264)+/g, " ");

  // Remove bracketed resolution or bitrate, e.g. "[1080p]", "(4M1080)", "[7.5M1080]" (keep [4K] and [8K])
  clean = clean.replace(/[\[(]\s*(?:480|576|720|1080|1280|1440|1920|2160|4320|\d+(?:\.\d+)?[MmGg]\d*)[pPiI]?\s*[\])]/gi, "");

  // Remove trailing or mid-string bandwidth and pixel specs (e.g., " 4M1080", " 7.5M1080", " 8M")
  clean = clean.replace(/(?:\s+|-|_)+(?:\d+(?:\.\d+)?[MmGg](?:[bB][pP][sS])?\d*[pPiI]?)/gi, "");

  // Remove trailing or mid-string numerical resolution tags (e.g., " 1080", " 720")
  clean = clean.replace(/(?:\s+|-|_)+(?:(?:480|576|720|1080|1280|1440|1920|2160|4320)(?:[pPiI]\d*|fps|FPS)?|\d+[pPiI]\d*)/gi, "");

  // Remove empty brackets or parentheses remaining from substitutions
  clean = clean.replace(/[\[(（【]\s*[\])）】]/g, ""); // First remove empty pairs like ( ) or （ ）
  clean = clean.replace(/(?:\s+|-|_)*[\[()（）【】\]]/g, ""); // Then remove leftover standalone bracket characters

  return clean.trim();
}

// Normalize channel names by making them lower-case and stripping all spaces/whitespace to support smart matching (e.g., "cctv-1 综合" matches "cctv-1综合")
function normalizeChannelName(name: string): string {
  if (!name) return "";
  const stripped = stripBitrateAndResolution(name);
  let clean = stripped.toLowerCase().replace(/\s+/g, "");

  if (clean.includes("4k") || clean.includes("8k")) {
    clean = clean.replace("超高清", "");
  }
  
  // Special handling for CCTV 4K, 8K, and 超高清 to distinguish them from standard CCTV channels
  if (/^cctv/i.test(clean)) {
    if (clean.includes("4k")) {
      return "cctv4k";
    }
    if (clean.includes("8k")) {
      return "cctv8k";
    }
    if (clean.includes("超高清")) {
      return "cctv超高清";
    }
  }

  // Custom smart matching for CCTV channels (e.g., CCTV-1, CCTV1, CCTV1HD, CCTV-1综合, CCTV-1 综合HD, cctv 1, CCTV 5+)
  const cctvMatch = clean.match(/^cctv[-_]?(\d+)(\+)?(.*)$/);
  if (cctvMatch) {
    const num = cctvMatch[1];
    const plus = cctvMatch[2] || "";
    let sub = cctvMatch[3] || "";
    
    sub = sub
      .replace(/(hd|uhd|fhd|ud|(?<!超)高清|超清(?!高)|标清|sdi|channel|tv)/g, "")
      .replace(/(频道|电视台|台|版)$/, "")
      .trim();

    // Preserve regional and continent variants for CCTV channels (e.g., CCTV-4美洲, CCTV-4欧洲, CCTV-4亚洲)
    if (sub.includes("美洲") || sub.includes("america") || sub.includes("ame")) {
      return `cctv${num}${plus}美洲`;
    }
    if (sub.includes("欧洲") || sub.includes("europe") || sub.includes("euo") || sub.includes("eur")) {
      return `cctv${num}${plus}欧洲`;
    }
    if (sub.includes("亚洲") || sub.includes("asia")) {
      return `cctv${num}${plus}亚洲`;
    }

    // List of standard generic CCTV sub-category descriptors that map to the primary channel
    const genericSubs = [
      "综合", "财经", "综艺", "中文国际", "中文", "国际", "体育", "电影",
      "国防军事", "军事", "电视剧", "纪录", "科教", "戏曲", "社会与法",
      "新闻", "少儿", "音乐", "奥林匹克", "农业农村", "农业", "农村农业"
    ];

    if (sub && !genericSubs.includes(sub)) {
      return `cctv${num}${plus}${sub}`;
    }

    return `cctv${num}${plus}`;
  }
  
  // For other channels, remove hyphens, spaces, and common quality tags (preserving 4k, 8k, 超高清) to improve match rates
  return clean
    .replace(/[-_.\s]+/g, "")
    .replace(/(hd|uhd|fhd|ud|(?<!超)高清|超清(?!高)|标清|sdi|channel|tv)/g, "")
    .replace(/(频道|电视台|台)$/, "");
}

// Generate default epgId from channel name. CCTV5 and CCTV5+ are distinguished by keeping '+'. If processed epgId is empty, fallback to channel name.
function generateDefaultEpgId(name: string): string {
  if (!name) return "";
  // 1. Strip bitrate and resolution first
  let clean = stripBitrateAndResolution(name);
  
  // 2. Convert to lowercase
  clean = clean.toLowerCase();

  // 3. Remove spaces, hyphens, dots, underscores, braces, brackets, and common symbol noise
  clean = clean.replace(/[-_.\s※\(\)\[\]{\\}/]+/g, "");

  // Special handling for CCTV 4K, 8K, and 超高清
  if (/^cctv/i.test(clean)) {
    if (clean.includes("4k")) return "cctv4k";
    if (clean.includes("8k")) return "cctv8k";
    if (clean.includes("超高清")) return "cctv_chaogaoqing";
  }

  // 4. Custom matching for CCTV channels (CCTV-1, CCTV5+, CCTV-6电影, etc.)
  const cctvMatch = clean.match(/^cctv[-_]?(\d+)(\+)?(.*)$/);
  if (cctvMatch) {
    const num = cctvMatch[1];
    const plus = cctvMatch[2] || "";
    let sub = cctvMatch[3] || "";
    
    sub = sub
      .replace(/(fhd|uhd|hd|sd|hevc|h265|h264|1080p|720p|(?<!超)高清|超清(?!高)|标清|sdi|channel|tv)/g, "")
      .replace(/(频道|电视台|台|版)$/, "")
      .trim();

    if (sub.includes("美洲") || sub.includes("america") || sub.includes("ame")) {
      return `cctv${num}${plus}_meizhou`;
    }
    if (sub.includes("欧洲") || sub.includes("europe") || sub.includes("euo") || sub.includes("eur")) {
      return `cctv${num}${plus}_ouzhou`;
    }
    if (sub.includes("亚洲") || sub.includes("asia")) {
      return `cctv${num}${plus}_yazhou`;
    }

    return `cctv${num}${plus}`;
  }

  // 5. Remove quality/format words but ONLY if they are not the sole text (preserving 4k, 8k, 超高清).
  const noiseRegex = /(fhd|uhd|hd|sd|hevc|h265|h264|1080p|720p|(?<!超)高清|超清(?!高)|标清|sdi|channel|tv)/g;
  let withoutNoise = clean.replace(noiseRegex, "");
  if (withoutNoise.trim().length > 0) {
    clean = withoutNoise;
  }

  // 6. Return lowercase alphanumeric/Chinese sequence, or fallback to normalized text if empty
  let processed = clean.trim();
  return processed || name.toLowerCase().trim();
}

interface DefaultAliasGroup {
  template: string;
  aliases: string[];
}

const loadedDefaultAliases: DefaultAliasGroup[] = [];

function loadDefaultAliases() {
  const filePath = path.join(DATA_DIR, "default_aliases.txt");
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split(/\r?\n/);
      loadedDefaultAliases.length = 0; // reset
      for (const rawLine of lines) {
        let line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        // strip vertical bars or other common garbage
        if (line.startsWith("|")) {
          line = line.substring(1).trim();
        }
        const parts = line.split(",").map((s) => s.trim()).filter(Boolean);
        if (parts.length > 0) {
          const template = parts[0];
          const aliases = Array.from(new Set([template, ...parts]));
          loadedDefaultAliases.push({ template, aliases });
        }
      }
      console.log(`[Aliases] Loaded ${loadedDefaultAliases.length} default channel alias templates.`);
    } catch (e) {
      console.error("[Aliases] Failed to load default_aliases.txt", e);
    }
  }
}

// Helper to look up if rawName matches any known template/alias and return standard name + list of all known aliases
function findAliasTemplate(rawName: string): { templateName: string; aliases: string[] } | null {
  const normRaw = normalizeChannelName(rawName);
  if (!normRaw) return null;
  for (const group of loadedDefaultAliases) {
    if (group.aliases.some(a => normalizeChannelName(a) === normRaw)) {
      return {
        templateName: group.template,
        aliases: group.aliases,
      };
    }
  }
  return null;
}

// Seed Data
const DEFAULT_GROUPS: Group[] = [
  { id: "g_yangshi", name: "央视频道" },
  { id: "g_weishi", name: "卫视频道" },
  { id: "g_local", name: "地方频道" },
  { id: "g_other", name: "其它频道" }
];

const DEFAULT_CHANNELS: Channel[] = [
  {
    id: "cctv1",
    name: "CCTV-1 综合",
    logo: "https://vfiles.gtimg.cn/vupload/20210729/cf2b0d1627514936398.png",
    groupIds: ["g_yangshi"],
    alias: ["CCTV1", "CCTV-1 综合HD", "中央一套"],
    epgId: "cctv1",
    sources: [
      {
        id: "cctv1-s1",
        url: "http://ivi.bupt.edu.cn/hls/cctv1hd.m3u8",
        province: "北京",
        isp: "BGP",
        status: "unknown",
      },
      {
        id: "cctv1-s2",
        url: "http://39.134.115.163:8080/plsts/1/index.m3u8",
        province: "山东",
        isp: "移动",
        status: "unknown",
      }
    ]
  },
  {
    id: "cctv3",
    name: "CCTV-3 综艺",
    logo: "https://vfiles.gtimg.cn/vupload/20210729/cf2b0d1627515090124.png",
    groupIds: ["g_yangshi"],
    alias: ["CCTV3", "CCTV-3", "中央三套"],
    epgId: "cctv3",
    sources: [
      {
        id: "cctv3-s1",
        url: "http://ivi.bupt.edu.cn/hls/cctv3hd.m3u8",
        province: "北京",
        isp: "BGP",
        status: "unknown",
      }
    ]
  },
  {
    id: "cctv5",
    name: "CCTV-5 体育",
    logo: "https://vfiles.gtimg.cn/vupload/20210729/cf2b0d1627515090333.png",
    groupIds: ["g_yangshi"],
    alias: ["CCTV5", "CCTV-5", "中央五套", "CCTV5 体育"],
    epgId: "cctv5",
    sources: [
      {
        id: "cctv5-s1",
        url: "http://ivi.bupt.edu.cn/hls/cctv5hd.m3u8",
        province: "北京",
        isp: "BGP",
        status: "unknown",
      }
    ]
  },
  {
    id: "cctv6",
    name: "CCTV-6 电影",
    logo: "https://vfiles.gtimg.cn/vupload/20210729/cf2b0d1627515090444.png",
    groupIds: ["g_yangshi"],
    alias: ["CCTV6", "CCTV-6", "中央六套", "CCTV-6 电影"],
    epgId: "cctv6",
    sources: [
      {
        id: "cctv6-s1",
        url: "http://ivi.bupt.edu.cn/hls/cctv6hd.m3u8",
        province: "北京",
        isp: "BGP",
        status: "unknown",
      }
    ]
  },
  {
    id: "cctv13",
    name: "CCTV-13 新闻",
    logo: "https://vfiles.gtimg.cn/vupload/20210729/cf2b0d1627515091212.png",
    groupIds: ["g_yangshi"],
    alias: ["CCTV13", "CCTV-13", "中央十三套", "CCTV-13 新闻"],
    epgId: "cctv13",
    sources: [
      {
        id: "cctv13-s1",
        url: "http://ivi.bupt.edu.cn/hls/cctv13.m3u8",
        province: "北京",
        isp: "BGP",
        status: "unknown",
      }
    ]
  },
  {
    id: "hunantv",
    name: "湖南卫视",
    logo: "https://vfiles.gtimg.cn/vupload/20210729/cf2b0d1627515092123.jpg",
    groupIds: ["g_weishi"],
    alias: ["湖南卫视", "湖南台", "Hunan TV"],
    epgId: "hunantv",
    sources: [
      {
        id: "hunantv-s1",
        url: "http://ivi.bupt.edu.cn/hls/hunantv.m3u8",
        province: "北京",
        isp: "BGP",
        status: "unknown",
      }
    ]
  },
  {
    id: "zhejiangtv",
    name: "浙江卫视",
    logo: "https://vfiles.gtimg.cn/vupload/20210729/cf2b0d1627515591321.jpg",
    groupIds: ["g_weishi"],
    alias: ["浙江卫视", "浙江台", "Zhejiang TV"],
    epgId: "zhejiangtv",
    sources: [
      {
        id: "zhejiangtv-s1",
        url: "http://ivi.bupt.edu.cn/hls/zjhd.m3u8",
        province: "北京",
        isp: "BGP",
        status: "unknown",
      }
    ]
  }
];

const DEFAULT_SYNC_CONFIGS: SyncConfig[] = [
  {
    id: "sc-1",
    name: "範例 IPTV GitHub 源",
    url: "https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/ipv6.m3u",
    type: "m3u",
    status: "never",
  }
];

// Load Database from disk/SQLite
function loadData() {
  try {
    initSqlite();

    let legacyJsonFound = false;
    let parsed: any = null;

    // Check if the legacy json exists (initial transition or restored backup)
    if (fs.existsSync(DATA_FILE)) {
      console.log("[Migration] Found legacy/restored JSON data file. Loading and Syncing...");
      try {
        const content = fs.readFileSync(DATA_FILE, "utf-8");
        parsed = JSON.parse(content);
        legacyJsonFound = true;
      } catch (e: any) {
        console.error("[Migration Error] Failed to parse legacy JSON:", e.message || e);
      }
    }

    if (legacyJsonFound && parsed) {
      channels = parsed.channels || [];
      syncConfigs = parsed.syncConfigs || [];
      groups = parsed.groups || [];
      epgSources = parsed.epgSources || [];
      if (parsed.adminPassword !== undefined) {
        adminPassword = parsed.adminPassword;
      }
      if (parsed.githubProxy !== undefined) {
        githubProxy = parsed.githubProxy;
      }
      if (parsed.autoCreateChannel !== undefined) {
        autoCreateChannel = !!parsed.autoCreateChannel;
      }

      if (parsed.cronJobs && Array.isArray(parsed.cronJobs) && parsed.cronJobs.length > 0) {
         db.exec("DELETE FROM cron_jobs");
         const insertCron = db.prepare("INSERT INTO cron_jobs (id, name, startTime, intervalMinutes, active, nextRun, lastRun) VALUES (?, ?, ?, ?, ?, ?, ?)");
         for (const job of parsed.cronJobs) {
           insertCron.run(job.id, job.name, job.startTime || "00:00", job.intervalMinutes || 120, job.active === 1 || job.active === true ? 1 : 0, job.nextRun || null, job.lastRun || null);
         }
      }

      if (Array.isArray(parsed.carouselProxies)) {
        db.exec("DELETE FROM carousel_proxies");
        const ins = db.prepare("INSERT INTO carousel_proxies (id, platform, urlTemplate, status) VALUES (?, ?, ?, ?)");
        for (const item of parsed.carouselProxies) {
          ins.run(item.id || crypto.randomUUID(), item.platform || '', item.urlTemplate || '', item.status || 'active');
        }
      }

      if (Array.isArray(parsed.deletedCarouselProxies)) {
        db.exec("DELETE FROM deleted_carousel_proxies");
        const ins = db.prepare("INSERT OR REPLACE INTO deleted_carousel_proxies (urlTemplate, deletedAt) VALUES (?, ?)");
        for (const item of parsed.deletedCarouselProxies) {
          ins.run(item.urlTemplate || '', item.deletedAt || new Date().toISOString());
        }
      }

      if (Array.isArray(parsed.carouselChannels)) {
        db.exec("DELETE FROM carousel_channels");
        const ins = db.prepare("INSERT INTO carousel_channels (id, channelId, name, platform, originalId) VALUES (?, ?, ?, ?, ?)");
        for (const item of parsed.carouselChannels) {
          ins.run(item.id || crypto.randomUUID(), item.channelId || '', item.name || '', item.platform || '', item.originalId || '');
        }
      }

      if (Array.isArray(parsed.carouselDiscoveryRules)) {
        db.exec("DELETE FROM carousel_discovery_rules");
        const ins = db.prepare("INSERT INTO carousel_discovery_rules (id, platform, keyword, enabled) VALUES (?, ?, ?, ?)");
        for (const item of parsed.carouselDiscoveryRules) {
          ins.run(item.id || crypto.randomUUID(), item.platform || '', item.keyword || '', item.enabled === false ? 0 : 1);
        }
      }

      if (Array.isArray(parsed.carouselDisabledRules)) {
        db.exec("DELETE FROM carousel_disabled_rules");
        const ins = db.prepare("INSERT INTO carousel_disabled_rules (id, pattern, type, platform, description, enabled) VALUES (?, ?, ?, ?, ?, ?)");
        for (const item of parsed.carouselDisabledRules) {
          ins.run(item.id || crypto.randomUUID(), item.pattern || item.keyword || '', item.type || 'pattern', item.platform || '', item.description || '', item.enabled === false ? 0 : 1);
        }
      }

      // Populate SQLite with this state
      saveData();

      // Rename DATA_FILE so we don't migrate on every start
      try {
        const bakPath = DATA_FILE + ".bak";
        if (fs.existsSync(bakPath)) {
          fs.unlinkSync(bakPath); // remove old bak if any
        }
        fs.renameSync(DATA_FILE, bakPath);
        console.log(`[Migration] Legacy JSON file archived to ${bakPath}`);
      } catch (err: any) {
        console.error("[Migration Error] Failed to archive legacy JSON file:", err.message);
      }
    } else {
      // Load directly from SQLite
      const loadedSettings = db.prepare("SELECT * FROM settings").all();
      for (const row of loadedSettings as any[]) {
        if (row.key === "adminPassword") adminPassword = row.value;
        if (row.key === "githubProxy") githubProxy = row.value;
        if (row.key === "m3uLogoVersion") m3uLogoVersion = row.value;
        if (row.key === "carouselProxyPresets") { try { carouselProxyPresets = JSON.parse(row.value); } catch(e) {} }
        if (row.key === "autoCreateChannel") autoCreateChannel = (row.value === "true" || row.value === "1");
        if (row.key === "ipGeoApis") {
          try { ipGeoApis = JSON.parse(row.value); } catch(e) {}
        }
        if (row.key === "autoSwitchGeoApi") autoSwitchGeoApi = (row.value === "true" || row.value === "1");

      }

      const loadedGroups = db.prepare("SELECT * FROM groups").all();
      groups = loadedGroups.map((g: any) => ({
        id: g.id,
        name: g.name,
        isolated: g.isolated === 1 ? true : false
      }));

      const loadedSyncConfigs = db.prepare("SELECT * FROM sync_configs").all();
      syncConfigs = loadedSyncConfigs.map((sc: any) => ({
        id: sc.id,
        name: sc.name,
        url: sc.url,
        type: sc.type,
        lastSynced: sc.lastSynced || undefined,
        status: sc.status || "never",
        message: sc.message || undefined,
        disabled: sc.disabled === 1,
        consecutiveFailures: sc.consecutiveFailures || 0,
        contentHash: sc.contentHash || undefined,
        isp: sc.isp || undefined,
        aliasOnly: sc.aliasOnly === 1
      }));

      const loadedEpgSources = db.prepare("SELECT * FROM epg_sources").all();
      epgSources = loadedEpgSources.map((es: any) => ({
        id: es.id,
        name: es.name,
        url: es.url,
        active: es.active === 1,
        lastSynced: es.lastSynced || undefined,
        status: es.status || "never",
        message: es.message || undefined
      }));

      const dbChannels = db.prepare("SELECT * FROM channels").all();
      const dbSources = db.prepare("SELECT * FROM sources").all();
      const sourceMap = new Map<string, LiveSource[]>();
      
      for (const row of dbSources as any[]) {
        const src: LiveSource = {
          id: row.id,
          url: row.url,
          province: row.province || "",
          isp: row.isp || "",
          status: row.status || "unknown",
          latency: row.latency !== null ? row.latency : undefined,
          resolution: row.resolution || undefined,
          lastChecked: row.lastChecked || undefined,
          clientIspReported: row.clientIspReported || undefined,
          clientProvinceReported: row.clientProvinceReported || undefined,
          isolated: row.isolated === 1 ? true : false,
          testCount: row.testCount || 0,
          successCount: row.successCount || 0
        };
        if (!sourceMap.has(row.channelId)) {
          sourceMap.set(row.channelId, []);
        }
        sourceMap.get(row.channelId)!.push(src);
      }

      channels = dbChannels.map((ch: any) => {
        let groupIds: string[] = [];
        try {
          groupIds = JSON.parse(ch.groupIds || "[]");
        } catch {
          groupIds = ch.groupIds ? ch.groupIds.split(",") : [];
        }

        let alias: string[] = [];
        try {
          alias = JSON.parse(ch.alias || "[]");
        } catch {}

        return {
          id: ch.id,
          name: ch.name,
          logo: ch.logo || "",
          groupIds,
          alias,
          epgId: ch.epgId || "",
          isolated: ch.isolated === 1 ? true : false,
          sources: sourceMap.get(ch.id) || []
        };
      });
    }

    // Auto seed default EPG / configs if SQLite was completely empty
    const hasChannels = db.prepare("SELECT COUNT(*) as count FROM channels").get() as { count: number };
    if (hasChannels.count === 0 && channels.length === 0) {
      console.log("[SQLite Seed] Entire database is empty. Seeding defaults...");
      channels = DEFAULT_CHANNELS;
      syncConfigs = DEFAULT_SYNC_CONFIGS;
      groups = DEFAULT_GROUPS;
      epgSources = [
        {
          id: "epg_fanmingming",
          name: "Fanmingming 高速公开 EPG XML 源",
          url: "https://live.fanmingming.com/e.xml",
          active: true,
          status: "never",
        },
        {
          id: "epg_pw",
          name: "EPG.pw 公开 XML 源",
          url: "https://epg.pw/xmltv/epg_CN.xml",
          active: true,
          status: "never",
        }
      ];
      saveData();
    }

    // Run Migration: if groups collection or channel groupIds are missing
    let updated = false;
    
    // Migrate dead EPG sources
    epgSources.forEach((s) => {
      if (s.url === "http://epg.51zmt.top:11111/e.xml" || s.id === "epg_51zmt") {
        s.url = "https://epg.pw/xmltv/epg_CN.xml";
        s.name = "EPG.pw 公开 XML 源";
        s.id = "epg_pw";
        updated = true;
      }
    });

    // Migrate & Sanitize regional and 4K/8K/超高清 aliases from channels whose primary name is NOT regional or 4K/8K/超高清
    const regionalAliasPattern = /(美洲|欧洲|亚洲|america|europe|asia|AME|EUO|EUR)/i;
    const ultraHdAliasPattern = /(4K|8K|超高清)/i;

    channels.forEach(ch => {
      const isRegionalChannel = regionalAliasPattern.test(ch.name);
      const isUltraHdChannel = ultraHdAliasPattern.test(ch.name);

      if (ch.alias && ch.alias.length > 0) {
        const origLen = ch.alias.length;
        ch.alias = ch.alias.filter(a => {
          // Remove regional CCTV aliases from non-regional channels
          if (!isRegionalChannel && /cctv/i.test(a) && regionalAliasPattern.test(a)) {
            return false;
          }
          // Remove 4K / 8K / 超高清 aliases from non-4K/8K/超高清 channels
          if (!isUltraHdChannel && ultraHdAliasPattern.test(a)) {
            return false;
          }
          return true;
        });
        if (ch.alias.length !== origLen) {
          updated = true;
          console.log(`[Sanitize Migration] Cleaned erroneous aliases from channel "${ch.name}" (${ch.id})`);
        }
      }
    });

    // Re-assign sources mistakenly mapped to non-regional CCTV-4 to CCTV-4美洲 / CCTV-4欧洲
    const chMeizhou = channels.find(c => c.name === "CCTV-4美洲" || c.name === "CCTV4美洲");
    const chOuzhou = channels.find(c => c.name === "CCTV-4欧洲" || c.name === "CCTV4欧洲");
    channels.forEach(ch => {
      if (ch.name.includes("CCTV-4") && !ch.name.includes("美洲") && !ch.name.includes("欧洲")) {
        const remainingSources: LiveSource[] = [];
        for (const src of ch.sources || []) {
          const u = src.url || "";
          if ((u.includes("cctv4meihd") || u.includes("608807416")) && chMeizhou) {
            if (!chMeizhou.sources.some(s => s.id === src.id)) {
              chMeizhou.sources.push(src);
              updated = true;
            }
          } else if ((u.includes("cctv4ouhd") || u.includes("608807419")) && chOuzhou) {
            if (!chOuzhou.sources.some(s => s.id === src.id)) {
              chOuzhou.sources.push(src);
              updated = true;
            }
          } else {
            remainingSources.push(src);
          }
        }
        if (remainingSources.length !== (ch.sources || []).length) {
          ch.sources = remainingSources;
          updated = true;
        }
      }
    });

    if (groups.length === 0) {
      const uniqueCats = new Set<string>();
      channels.forEach((c: any) => {
        if (c.category) uniqueCats.add(c.category);
      });
      if (uniqueCats.size === 0) {
        groups = [...DEFAULT_GROUPS];
      } else {
        groups = Array.from(uniqueCats).map((catName) => ({
          id: "g_" + Math.random().toString(36).substring(2, 10),
          name: catName,
        }));
      }
      updated = true;
    }

    // Ensure all channels have groupIds array and map old category
    channels.forEach((c: any) => {
      if (!c.groupIds) {
        c.groupIds = [];
        updated = true;
      }
      if (c.category) {
        let matchingGroup = groups.find((g) => g.name === c.category);
        if (!matchingGroup) {
          matchingGroup = {
            id: "g_" + Math.random().toString(36).substring(2, 10),
            name: c.category,
          };
          groups.push(matchingGroup);
          updated = true;
        }
        if (!c.groupIds.includes(matchingGroup.id)) {
          c.groupIds.push(matchingGroup.id);
          updated = true;
        }
      }
      // Guarantee at least one group membership
      if (c.groupIds.length === 0) {
        let otherGroup = groups.find((g) => g.id === "g_other" || g.name === "其它频道");
        if (!otherGroup) {
          otherGroup = { id: "g_other", name: "其它频道" };
          groups.push(otherGroup);
          updated = true;
        }
        c.groupIds.push(otherGroup.id);
        updated = true;
      }
    });

    // Validate or Repair Channel EPG IDs to resolve generic duplicates like "hd", "1080p", "4k" or blank EPG IDs
    channels.forEach((c: any) => {
      const invalidGenericIds = ["hd", "sd", "fhd", "uhd", "hevc", "h265", "h264", "1080p", "720p", "4k", "8k", "高清", "超清", "标清", "sdi", "channel", "tv"];
      if (!c.epgId || c.epgId.trim().length === 0 || (typeof c.epgId === "string" && invalidGenericIds.includes(c.epgId.toLowerCase().trim()))) {
        const freshEpgId = generateDefaultEpgId(c.name);
        if (freshEpgId !== c.epgId) {
          console.log(`[Repair EPG ID] Repairing bad/duplicate epgId "${c.epgId}" for channel "${c.name}" -> "${freshEpgId}"`);
          c.epgId = freshEpgId;
          updated = true;
        }
      }
    });

    // Auto-heal / un-isolate RTSP and intranet streams that were falsely isolated or marked inactive in the past
    channels.forEach((c: any) => {
      (c.sources || []).forEach((s: any) => {
        if (isPrivateOrIntranetUrl(s.url)) {
          const isTimeout = s.latency !== undefined && s.latency >= 9999;
          if (!isTimeout) {
            if (s.isolated) {
              s.isolated = false;
              updated = true;
            }
            if (s.status === "inactive") {
              s.status = "active";
              updated = true;
            }
          }
        }
      });
    });

    if (updated) {
      saveDataSync();
    } else {
      // Proactively generate caches on startup if not updated
      setTimeout(() => {
        try {
          getOrGenerateIntegratedEpgXml();
          generateDefaultPlaylists();
        } catch(e) {
          console.error("[STARTUP CACHE GEN ERROR]", e);
        }
      }, 2000);
    }

  } catch (error) {
    console.error("Failed to load IPTV data from SQLite:", error);
    channels = DEFAULT_CHANNELS;
    syncConfigs = DEFAULT_SYNC_CONFIGS;
    groups = DEFAULT_GROUPS;
  }
}

// Save Database to SQLite disk
let saveTimer: NodeJS.Timeout | null = null;
let globalLastDataUpdate = Date.now();
let shouldInvalidateCaches = false;

function saveData(invalidate = true) {
  if (invalidate) {
    shouldInvalidateCaches = true;
  }
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveDataSync();
  }, 1000);
}

function generateDefaultPlaylists() {
  const m3uPath = path.join(DATA_DIR, "iptv_custom.m3u");
  const txtPath = path.join(DATA_DIR, "iptv_custom.txt");

  let playlistRows = [`#EXTM3U x-tvg-url="/api/export/epg.xml.gz"`];
  const exportMap = new Map<string, string[]>();
  let count = 0;
  const maxLimit = Infinity;
  const maxPerChannel = 15;

  const orderedGroups = [...groups, { id: "g_other", name: "其它频道" }];
  
  orderedGroups.forEach((group) => {
    if (group.isolated) return;
    channels.forEach((channel) => {
      if (channel.isolated) return;
      const isInGroup = channel.groupIds.includes(group.id);
      const isFallback = group.id === "g_other" && (channel.groupIds.length === 0 || !channel.groupIds.some(id => groups.find(g => g.id === id)));
      if (!isInGroup && !isFallback) return;

      let processedSources = channel.sources.filter(source => source.status === "active");
      processedSources = sortSourcesForExport(processedSources);
      
      const sourcesToExport = processedSources.slice(0, maxPerChannel);
      const groupName = group.name;

      sourcesToExport.forEach(bestSource => {
        if (count >= maxLimit) return;
        const channelDisplayName = channel.name;
        
        // M3U
        playlistRows.push(
          `#EXTINF:-1 tvg-id="${channel.epgId}" tvg-name="${channel.name}" tvg-logo="${channel.logo}" group-title="${groupName}",${channelDisplayName}`
        );
        playlistRows.push(bestSource.url);

        // TXT
        if (!exportMap.has(groupName)) {
          exportMap.set(groupName, []);
        }
        exportMap.get(groupName)!.push(`${channel.name},${bestSource.url}`);
        
        count++;
      });
    });
  });

  const m3uContent = playlistRows.join("\n");
  
  const fileRows: string[] = [];
  exportMap.forEach((lines, catName) => {
    fileRows.push(`${catName},#genre`);
    fileRows.push(...lines);
    fileRows.push("");
  });
  const txtContent = fileRows.join("\n");

  try {
    fs.writeFileSync(m3uPath, m3uContent, "utf-8");
    fs.writeFileSync(txtPath, txtContent, "utf-8");
  } catch (err) {
    console.error("[STATIC PLAYLIST WRITE ERROR]", err);
  }
}

function saveDataSync() {
  globalLastDataUpdate = Date.now();
  if (shouldInvalidateCaches) {
    invalidateIntegratedEpgCache();
    invalidatePlaylistExportCache();
    shouldInvalidateCaches = false;
    
    // Proactively generate caches to ensure they are available in /data
    try {
      getOrGenerateIntegratedEpgXml();
      generateDefaultPlaylists();
    } catch(e) {
      console.error("[PROACTIVE CACHE GEN ERROR]", e);
    }
  }
  try {
    const syncDb = db.transaction(() => {
      // 1. Sync settings
      const insertSetting = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
      insertSetting.run("adminPassword", adminPassword);
      insertSetting.run("githubProxy", githubProxy);
      insertSetting.run("autoCreateChannel", autoCreateChannel ? "true" : "false");
      insertSetting.run("m3uLogoVersion", m3uLogoVersion);
      insertSetting.run("carouselProxyPresets", JSON.stringify(carouselProxyPresets));
      insertSetting.run("ipGeoApis", JSON.stringify(ipGeoApis));
      insertSetting.run("autoSwitchGeoApi", autoSwitchGeoApi ? "true" : "false");


      // 2. Sync groups
      db.exec("DELETE FROM groups");
      const insertGroup = db.prepare("INSERT INTO groups (id, name, isolated) VALUES (?, ?, ?)");
      for (const g of groups) {
        insertGroup.run(g.id, g.name, g.isolated ? 1 : 0);
      }

      // 3. Sync channels & sources
      db.exec("DELETE FROM channels");
      db.exec("DELETE FROM sources");

      const insertChannel = db.prepare("INSERT INTO channels (id, name, logo, groupIds, alias, epgId, isolated) VALUES (?, ?, ?, ?, ?, ?, ?)");
      const insertSource = db.prepare(`
        INSERT INTO sources (id, channelId, url, province, isp, status, latency, resolution, lastChecked, clientIspReported, clientProvinceReported, testCount, successCount, isolated)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const ch of channels) {
        insertChannel.run(
          ch.id,
          ch.name,
          ch.logo || "",
          JSON.stringify(ch.groupIds || []),
          JSON.stringify(ch.alias || []),
          ch.epgId || "",
          ch.isolated ? 1 : 0
        );

        if (ch.sources && ch.sources.length > 0) {
          for (const s of ch.sources) {
            insertSource.run(
              s.id,
              ch.id,
              s.url,
              s.province || "",
              s.isp || "",
              s.status || "unknown",
              s.latency !== undefined ? s.latency : null,
              s.resolution || "",
              s.lastChecked || "",
              s.clientIspReported || "",
              s.clientProvinceReported || "",
              s.testCount || 0,
              s.successCount || 0,
              s.isolated ? 1 : 0
            );
          }
        }
      }

      // 4. Sync sync_configs
      db.exec("DELETE FROM sync_configs");
      const insertSync = db.prepare(`
        INSERT INTO sync_configs (id, name, url, type, autoSync, syncInterval, lastSynced, status, message, disabled, consecutiveFailures, contentHash, isp, aliasOnly)
        VALUES (?, ?, ?, ?, 1, 12, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const sc of syncConfigs) {
        insertSync.run(
          sc.id,
          sc.name,
          sc.url,
          sc.type,
          sc.lastSynced || "",
          sc.status || "never",
          sc.message || "",
          sc.disabled ? 1 : 0,
          sc.consecutiveFailures || 0,
          sc.contentHash || "",
          sc.isp || "",
          sc.aliasOnly ? 1 : 0
        );
      }

      // 5. Sync epg_sources
      db.exec("DELETE FROM epg_sources");
      const insertEpg = db.prepare(`
        INSERT INTO epg_sources (id, name, url, active, lastSynced, status, message)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const epg of epgSources) {
        insertEpg.run(
          epg.id,
          epg.name,
          epg.url,
          epg.active ? 1 : 0,
          epg.lastSynced || "",
          epg.status || "never",
          epg.message || ""
        );
      }
    });

    syncDb();
  } catch (error) {
    console.error("Failed to save IPTV data to SQLite:", error);
  }
}

// Automated Daily Backup of SQLite to prevent accidental data loss
function checkAndPerformDailyBackup() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const sqlitePath = path.join(DATA_DIR, "iptv_sqlite.db");
    if (!fs.existsSync(sqlitePath)) {
      return; 
    }
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const dateStr = `${year}-${month}-${day}`;
    
    const backupDbName = `iptv_data_sqlite_backup_${dateStr}.db`;
    const backupDbPath = path.join(DATA_DIR, backupDbName);
    
    if (!fs.existsSync(backupDbPath)) {
      console.log(`[Backup] Generating daily automated SQLite snapshot: ${backupDbName}`);
      fs.copyFileSync(sqlitePath, backupDbPath);

      // Generate a companion restorable legacy JSON file, compressed
      const backupJsonName = `iptv_data_backup_${dateStr}.json.gz`;
      const backupJsonPath = path.join(DATA_DIR, backupJsonName);
      if (!fs.existsSync(backupJsonPath)) {
        const backupJson = {
          groups,
          channels,
          syncConfigs,
          epgSources,
          adminPassword,
          githubProxy,
          carouselProxies: db.prepare("SELECT * FROM carousel_proxies").all(),
          deletedCarouselProxies: db.prepare("SELECT * FROM deleted_carousel_proxies").all(),
          carouselChannels: db.prepare("SELECT * FROM carousel_channels").all(),
          carouselDiscoveryRules: db.prepare("SELECT * FROM carousel_discovery_rules").all(),
          carouselDisabledRules: db.prepare("SELECT * FROM carousel_disabled_rules").all(),
        };
        fs.writeFileSync(backupJsonPath, zlib.gzipSync(Buffer.from(JSON.stringify(backupJson, null, 2), "utf-8")));
      }
      
      cleanOldBackups();
    }
  } catch (err) {
    console.error("[Backup] Daily automated backup failed:", err);
  }
}

function cleanOldBackups() {
  try {
    const files = fs.readdirSync(DATA_DIR);
    
    const autoJsonBackups = files.filter(f => f.startsWith("iptv_data_backup_2") && (f.endsWith(".json") || f.endsWith(".json.gz"))).sort();
    const autoSqliteBackups = files.filter(f => f.startsWith("iptv_data_sqlite_backup_") && f.endsWith(".db")).sort();
    
    // 我们保留最近的 30 个手动备份和还原前备份
    const manualBackups = files.filter(f => (f.startsWith("iptv_data_backup_manual_") || f.startsWith("iptv_data_backup_before_restore_")) && (f.endsWith(".json") || f.endsWith(".json.gz")))
        .map(f => ({ name: f, time: fs.statSync(path.join(DATA_DIR, f)).mtime.getTime() }))
        .sort((a, b) => a.time - b.time)
        .map(obj => obj.name);

    if (autoJsonBackups.length > 30) {
      const extra = autoJsonBackups.slice(0, autoJsonBackups.length - 30);
      for (const f of extra) { fs.unlinkSync(path.join(DATA_DIR, f)); console.log(`[Backup] Deleted old auto JSON backup: ${f}`); }
    }
    
    if (autoSqliteBackups.length > 30) {
      const extra = autoSqliteBackups.slice(0, autoSqliteBackups.length - 30);
      for (const f of extra) { fs.unlinkSync(path.join(DATA_DIR, f)); console.log(`[Backup] Deleted old auto SQLite backup: ${f}`); }
    }
    
    if (manualBackups.length > 30) {
      const extra = manualBackups.slice(0, manualBackups.length - 30);
      for (const f of extra) { fs.unlinkSync(path.join(DATA_DIR, f)); console.log(`[Backup] Deleted old manual backup: ${f}`); }
    }
  } catch (err) {
    console.error("[Backup] Error cleaning up old backups:", err);
  }
}

loadDefaultAliases();
loadData();
checkAndPerformDailyBackup();

// Utility function to map URL and parse ISP/Province
function parseIspAndProvince(name: string): { province: string; isp: string } {
  let province = "全国";
  let isp = "BGP";

  const provinces = [
    "北京", "上海", "天津", "重庆", "河北", "山西", "辽宁", "吉林", "黑龙江", "江苏",
    "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "海南",
    "四川", "贵州", "云南", "陕西", "甘肃", "青海", "台湾", "内蒙古", "广西", "西藏",
    "宁夏", "新疆", "香港", "澳门"
  ];
  for (const p of provinces) {
    if (name.includes(p)) {
      province = p;
      break;
    }
  }

  const isps = [
    { key: "电信", label: "电信" },
    { key: "联通", label: "联通" },
    { key: "移动", label: "移动" },
    { key: "广电", label: "广电" },
    { key: "铁通", label: "铁通" },
    { key: "BGP", label: "BGP" }
  ];
  for (const i of isps) {
    if (name.includes(i.key) || name.toLowerCase().includes(i.key.toLowerCase())) {
      isp = i.label;
      break;
    }
  }

  return { province, isp };
}

function isPrivateOrIntranetUrl(urlStr: string): boolean {
  if (!urlStr) return false;
  try {
    const urlLower = urlStr.toLowerCase().trim();
    if (
      urlLower.startsWith("rtsp://") ||
      urlLower.startsWith("rtmp://") ||
      urlLower.startsWith("udp://") ||
      urlLower.startsWith("rtp://") ||
      urlLower.startsWith("p2p://")
    ) {
      return true;
    }
    const withoutProtocol = urlLower.includes("://") ? urlLower.split("://")[1] : urlLower;
    const hostPort = withoutProtocol.split("/")[0].split("?")[0];
    const atIndex = hostPort.indexOf("@");
    const endpoint = atIndex === -1 ? hostPort : hostPort.substring(atIndex + 1);
    
    let host = endpoint;
    if (endpoint.startsWith("[")) {
      const closingIndex = endpoint.indexOf("]");
      if (closingIndex !== -1) {
        host = endpoint.substring(1, closingIndex);
      }
    } else if (endpoint.includes(":")) {
      host = endpoint.split(":")[0];
    }

    if (!host) return false;

    if (
      host === "localhost" ||
      host.endsWith(".local") ||
      host.endsWith(".lan") ||
      host.startsWith("127.") ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      host.startsWith("100.") ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
    ) {
      return true;
    }

    const parts = host.split(".").map(Number);
    if (parts.length === 4 && parts.every((p) => !isNaN(p))) {
      if (parts[0] >= 224 && parts[0] <= 239) return true;
    }
  } catch (e) {}
  return false;
}

function parseH264Sps(buf: Buffer): string | undefined {
  if (!buf || buf.length < 16) return undefined;
  for (let i = 0; i < buf.length - 12; i++) {
    if (buf[i] === 0 && buf[i + 1] === 0 && (buf[i + 2] === 1 || (buf[i + 2] === 0 && buf[i + 3] === 1))) {
      const start = buf[i + 2] === 1 ? i + 3 : i + 4;
      if (start >= buf.length) continue;
      const nalType = buf[start] & 0x1F;
      if (nalType === 7) {
        try {
          const sps = buf.subarray(start + 1, Math.min(buf.length, start + 35));
          let bitPos = 0;
          function readBit(): number {
            const byteIdx = Math.floor(bitPos / 8);
            const bitIdx = 7 - (bitPos % 8);
            bitPos++;
            if (byteIdx >= sps.length) return 0;
            return (sps[byteIdx] >> bitIdx) & 1;
          }
          function readUE(): number {
            let zeros = 0;
            while (readBit() === 0 && zeros < 32) zeros++;
            let val = 0;
            for (let k = 0; k < zeros; k++) {
              val = (val << 1) | readBit();
            }
            return (1 << zeros) - 1 + val;
          }
          readBit(); // profile_idc
          bitPos += 16;
          readUE();
          const profileIdc = sps[0];
          if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profileIdc)) {
            const chromaFormatIdc = readUE();
            if (chromaFormatIdc === 3) readBit();
            readUE(); readUE(); readBit();
          }
          readUE();
          const picOrderCntType = readUE();
          if (picOrderCntType === 0) readUE();
          else if (picOrderCntType === 1) {
            readBit(); readUE(); readUE();
            const numRef = readUE();
            for (let r = 0; r < numRef; r++) readUE();
          }
          readUE();
          readBit();
          const widthMbs = readUE();
          const heightMapUnits = readUE();
          const width = (widthMbs + 1) * 16;
          const height = (heightMapUnits + 1) * 16;
          if (width >= 100 && height >= 100 && width <= 8192 && height <= 8192) {
            if (height >= 2160 || width >= 3840) return "4K";
            if (height >= 1080 || width >= 1920) return "1080p";
            if (height >= 720 || width >= 1280) return "720p";
            if (height >= 576 || width >= 720) return "576p";
            if (height >= 480 || width >= 640) return "480p";
            return `${width}x${height}`;
          }
        } catch (_) {}
      }
    }
  }
  return undefined;
}

function parseResolution(url: string, textOrHeader?: string): string | undefined {
  if (textOrHeader) {
    const resMatch = textOrHeader.match(/RESOLUTION=(\d+)x(\d+)/i);
    if (resMatch) {
      const w = parseInt(resMatch[1], 10);
      const h = parseInt(resMatch[2], 10);
      if (h >= 2160 || w >= 3840) return "4K";
      if (h >= 1080 || w >= 1920) return "1080p";
      if (h >= 720 || w >= 1280) return "720p";
      if (h >= 576 || w >= 720) return "576p";
      if (h >= 480 || w >= 640) return "480p";
      return `${w}x${h}`;
    }
  }

  const urlLower = url.toLowerCase();
  if (/(3840x2160|2160p|4k|uhd)/i.test(urlLower)) return "4K";
  if (/(1920x1080|1080p|1080i|4m1080|7\.5m1080|8m1080)/i.test(urlLower)) return "1080p";
  if (/(1280x720|720p|720i|2m720)/i.test(urlLower)) return "720p";
  if (/(720x576|704x576|576p|576i)/i.test(urlLower)) return "576p";
  if (/(640x480|480p)/i.test(urlLower)) return "480p";

  return undefined;
}

// Stream Resolution probe using ffprobe
async function probeStreamResolutionWithFfprobe(url: string, timeoutMs = 1000): Promise<string | undefined> {
  if (isPrivateOrIntranetUrl(url)) return undefined;

  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-probesize", "500000",
      "-analyzeduration", "500000",
      "-rw_timeout", `${timeoutMs * 1000}`,
      "-timeout", `${timeoutMs * 1000}`,
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "json",
      "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      url
    ], { timeout: timeoutMs + 300 });

    const data = JSON.parse(stdout);
    if (data && data.streams && data.streams.length > 0) {
      const v = data.streams[0];
      const w = parseInt(v.width, 10);
      const h = parseInt(v.height, 10);
      if (w > 0 && h > 0) {
        if (h >= 2160 || w >= 3840) return "4K";
        if (h >= 1080 || w >= 1920) return "1080p";
        if (h >= 720 || w >= 1280) return "720p";
        if (h >= 576 || w >= 720) return "576p";
        if (h >= 480 || w >= 640) return "480p";
        return `${w}x${h}`;
      }
    }
  } catch (_) {
    // ffprobe failed or timed out
  }
  return undefined;
}

// URL Testing Engine
async function testSingleUrl(url: string, timeoutMs: number = 3000): Promise<{ status: "active" | "inactive"; latency: number; resolution?: string }> {
  const startTime = Date.now();

  const urlLower = url.toLowerCase();
  const isNonHttp = urlLower.startsWith("rtsp://") || urlLower.startsWith("rtmp://") || urlLower.startsWith("rtp://") || urlLower.startsWith("udp://") || urlLower.startsWith("p2p://");

  if (isNonHttp) {
    try {
      const isRtmp = urlLower.startsWith("rtmp://");
      const defaultPort = isRtmp ? 1935 : 554;
      const protocolLength = url.indexOf("://") + 3;
      const withoutProtocol = url.substring(protocolLength);
      const slNameIndex = withoutProtocol.indexOf("/");
      const hostPortPart = slNameIndex === -1 ? withoutProtocol : withoutProtocol.substring(0, slNameIndex);
      
      const atIndex = hostPortPart.indexOf("@");
      const endpointPart = atIndex === -1 ? hostPortPart : hostPortPart.substring(atIndex + 1);
      
      let host = "";
      let port = defaultPort;
      
      if (endpointPart.startsWith("[")) {
        const closingBracket = endpointPart.indexOf("]");
        if (closingBracket !== -1) {
          host = endpointPart.substring(1, closingBracket);
          const remaining = endpointPart.substring(closingBracket + 1);
          if (remaining.startsWith(":")) {
            port = parseInt(remaining.substring(1), 10) || defaultPort;
          }
        } else {
          host = endpointPart;
        }
      } else {
        const colonIndex = endpointPart.lastIndexOf(":");
        if (colonIndex !== -1) {
          host = endpointPart.substring(0, colonIndex);
          port = parseInt(endpointPart.substring(colonIndex + 1), 10) || defaultPort;
        } else {
          host = endpointPart;
          port = defaultPort;
        }
      }

      if (isPrivateOrIntranetUrl(url)) {
        return { status: "active", latency: 60, resolution: parseResolution(url) };
      }

      const socketTimeout = Math.max(timeoutMs, 4000);
      return new Promise((resolve) => {
        const socket = net.connect({
          host,
          port,
          timeout: socketTimeout
        }, async () => {
          const latency = Date.now() - startTime;
          try {
            if (urlLower.startsWith("rtsp://")) {
              socket.write(`OPTIONS rtsp://${host}:${port}/ RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: Lavf/58.29.100\r\n\r\n`);
            }
          } catch (e) {}
          socket.destroy();
          const fastRes = parseResolution(url);
          const probedRes = fastRes ? fastRes : await probeStreamResolutionWithFfprobe(url, 1000).catch(() => undefined);
          resolve({ status: "active", latency, resolution: probedRes || fastRes });
        });
        socket.on("error", () => {
          socket.destroy();
          if (isPrivateOrIntranetUrl(url) || urlLower.startsWith("rtsp://")) {
            resolve({ status: "active", latency: 80, resolution: parseResolution(url) });
          } else {
            resolve({ status: "inactive", latency: Date.now() - startTime });
          }
        });
        socket.on("timeout", () => {
          socket.destroy();
          if (isPrivateOrIntranetUrl(url) || urlLower.startsWith("rtsp://")) {
            resolve({ status: "active", latency: 80, resolution: parseResolution(url) });
          } else {
            resolve({ status: "inactive", latency: Date.now() - startTime });
          }
        });
      });
    } catch (e) {
      if (isPrivateOrIntranetUrl(url) || urlLower.startsWith("rtsp://")) {
        return { status: "active", latency: 80, resolution: parseResolution(url) };
      }
      return { status: "inactive", latency: Date.now() - startTime };
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    clearTimeout(timeoutId);
    
    if (response.ok) {
      const latency = Date.now() - startTime;
      let resolution: string | undefined = parseResolution(url);

      try {
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("mpegurl") || urlLower.endsWith(".m3u8") || contentType.includes("text")) {
          const text = await response.text();
          const parsed = parseResolution(url, text);
          if (parsed) resolution = parsed;
        } else if (response.body) {
          const reader = response.body.getReader();
          const { value } = await reader.read();
          if (value && value.length > 0) {
            const buf = Buffer.from(value);
            const spsRes = parseH264Sps(buf);
            if (spsRes) resolution = spsRes;
          }
          try { await reader.cancel(); } catch (_) {}
        }
      } catch (err) {
      }

      // ONLY execute ffprobe if fast parsing (URL regex / M3U8 tags / H264 SPS) produced NO resolution at all
      if (!resolution) {
        const probedRes = await probeStreamResolutionWithFfprobe(url, 1000).catch(() => undefined);
        if (probedRes) {
          resolution = probedRes;
        }
      }

      return { status: "active", latency, resolution };
    } else {
      return { status: "inactive", latency: Date.now() - startTime };
    }
  } catch (err) {
    clearTimeout(timeoutId);
    return { status: "inactive", latency: Date.now() - startTime };
  }
}

// Thread-pool model for Concurrent Bulk Tests
async function runConcurrentTest(selectedSources: { id: string; channelId: string; url: string }[], concurrency = 8) {
  testStatus.status = "running";
  testStatus.total = selectedSources.length;
  testStatus.checked = 0;
  testStatus.results = [];

  const queue = [...selectedSources];

  const runWorker = async () => {
    while (queue.length > 0) {
      if (testStatus.status !== "running") break;
      const item = queue.shift();
      if (!item) continue;

      updateSourceDbStatus(item.channelId, item.id, "checking", undefined);

      const result = await testSingleUrl(item.url);

      updateSourceDbStatus(item.channelId, item.id, result.status, result.latency, result.resolution);

      testStatus.checked++;
      testStatus.results.push({
        id: item.id,
        channelId: item.channelId,
        url: item.url,
        status: result.status,
        latency: result.latency,
        resolution: result.resolution,
      });
    }
  };

  const pool = Array.from({ length: Math.min(concurrency, queue.length) }, runWorker);
  await Promise.all(pool);

  testStatus.status = "idle";
  saveData(true);
}

function updateSourceDbStatus(channelId: string, sourceId: string, status: "active" | "inactive" | "checking" | "unknown", latency?: number, resolution?: string) {
  const channel = channels.find((c) => c.id === channelId);
  if (channel) {
    const source = channel.sources.find((s) => s.id === sourceId);
    if (source) {
      source.status = status;
      if (latency !== undefined) {
        source.latency = latency;
      }
      if (resolution) {
        source.resolution = resolution;
      }
      source.lastChecked = new Date().toISOString();
    }
  }
}

function ensureArray<T>(val: any): T[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return [val];
}

function getText(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (typeof node === "object") {
    if (node["#text"] !== undefined) return String(node["#text"]);
    if (node.text !== undefined) return String(node.text);
    for (const key in node) {
      if (typeof node[key] === "string" && key !== "lang") {
        return node[key];
      }
    }
  }
  return "";
}

function parseXmltvTime(timeStr: string): { dateStr: string, timeStr: string } {
  if (!timeStr) return { dateStr: "", timeStr: "" };
  const match = timeStr.trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (match) {
    const [_, y, m, d, hh, mm, ss] = match;
    return {
      dateStr: `${y}-${m}-${d}`,
      timeStr: `${hh}:${mm}`
    };
  }
  return { dateStr: "", timeStr: "" };
}

function buildEpgIndex(channelMap: Record<string, EpgEntry>): EpgCacheIndexed {
  const idMap = new Map<string, EpgEntry>();
  const nameMap = new Map<string, EpgEntry>();

  for (const [originalId, entry] of Object.entries(channelMap)) {
    if (!originalId) continue;
    idMap.set(originalId.toLowerCase(), entry);

    const normId = normalizeChannelName(originalId);
    if (normId && !idMap.has(normId)) {
      idMap.set(normId, entry);
    }

    if (entry.displayNames && Array.isArray(entry.displayNames)) {
      for (const disp of entry.displayNames) {
        const normDisp = normalizeChannelName(disp);
        if (normDisp && !nameMap.has(normDisp)) {
          nameMap.set(normDisp, entry);
        }
      }
    }
  }

  return {
    raw: channelMap,
    idMap,
    nameMap,
  };
}

function getEpgCache(sourceId: string): EpgCacheIndexed | null {
  const cachePath = path.join(EPG_CACHE_DIR, `${sourceId}.json`);
  if (!fs.existsSync(cachePath)) return null;
  if (loadedEpgCaches[sourceId]) {
    return loadedEpgCaches[sourceId];
  }
  try {
    const data = fs.readFileSync(cachePath, "utf-8");
    const rawMap: Record<string, EpgEntry> = JSON.parse(data);
    const indexed = buildEpgIndex(rawMap);
    loadedEpgCaches[sourceId] = indexed;
    return indexed;
  } catch (err) {
    console.error(`[EPG CACHE LOAD ERROR] for ${sourceId}:`, err);
    return null;
  }
}

function findMatchingEpgEntry(ch: Channel, cache: EpgCacheIndexed): EpgEntry | null {
  if (!cache) return null;

  // 1. Check channel name normalized (priority)
  const chNameNorm = normalizeChannelName(ch.name);
  if (chNameNorm && cache.nameMap.has(chNameNorm)) {
    return cache.nameMap.get(chNameNorm)!;
  }

  // 2. Check channel alias normalized
  if (ch.alias && Array.isArray(ch.alias)) {
    for (const a of ch.alias) {
      const aNorm = normalizeChannelName(a);
      if (aNorm && cache.nameMap.has(aNorm)) {
        return cache.nameMap.get(aNorm)!;
      }
    }
  }

  // 3. Check default templates and aliases
  const aliasTemplate = findAliasTemplate(ch.name);
  if (aliasTemplate) {
    const tNorm = normalizeChannelName(aliasTemplate.templateName);
    if (tNorm && cache.nameMap.has(tNorm)) {
      return cache.nameMap.get(tNorm)!;
    }
    for (const a of aliasTemplate.aliases) {
      const aNorm = normalizeChannelName(a);
      if (aNorm && cache.nameMap.has(aNorm)) {
        return cache.nameMap.get(aNorm)!;
      }
    }
  }

  return null;
}

function getOrGenerateIntegratedEpgXml(): { xml: string; gz: Buffer; etag: string } {
  const now = Date.now();

  // 1. Check in-memory cache (No TTL)
  if (
    integratedEpgXmlCache &&
    integratedEpgXmlGzCache &&
    integratedEpgEtag
  ) {
    return { xml: integratedEpgXmlCache, gz: integratedEpgXmlGzCache, etag: integratedEpgEtag };
  }

  // 2. Check disk file cache (No TTL)
  try {
    if (fs.existsSync(EPG_EXPORT_XML_PATH) && fs.existsSync(EPG_EXPORT_GZ_PATH)) {
      const stats = fs.statSync(EPG_EXPORT_GZ_PATH);
      const xml = fs.readFileSync(EPG_EXPORT_XML_PATH, "utf-8");
      const gz = fs.readFileSync(EPG_EXPORT_GZ_PATH);
      const etag = `W/"epg-${Math.floor(stats.mtimeMs)}-${stats.size}"`;

      integratedEpgXmlCache = xml;
      integratedEpgXmlGzCache = gz;
      integratedEpgCacheTime = stats.mtimeMs;
      integratedEpgEtag = etag;

      return { xml, gz, etag };
    }
  } catch (e) {
    console.warn("[EPG DISK CACHE LOAD WARN]", e);
  }

  const xmlHeader = `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE tv SYSTEM "xmltv.dtd"><tv generator-info-name="IPTV Channel Manager" generator-info-url="http://localhost:3000/">`;
  
  const activeEpgSources = epgSources.filter(s => s.active);
  const activeCaches = activeEpgSources
    .map(s => getEpgCache(s.id))
    .filter(Boolean) as EpgCacheIndexed[];

  const activeExportChannels = channels.filter((c) => !c.isolated);

  const channelTags = activeExportChannels.map((c) => {
    const epgIdEscaped = escapeXml(c.epgId || generateDefaultEpgId(c.name));
    return `  <channel id="${epgIdEscaped}">\n    <display-name lang="zh">${escapeXml(c.name)}</display-name>\n    <icon src="${escapeXml(c.logo)}" />\n  </channel>`;
  }).join("\n");

  const todayStr = new Date().toISOString().split("T")[0].replace(/-/g, "");

  const programTags = activeExportChannels.map((c) => {
    const epgIdEscaped = escapeXml(c.epgId || generateDefaultEpgId(c.name));
    
    let matchedPrograms: any[] = [];
    let found = false;
    for (const cache of activeCaches) {
      const entry = findMatchingEpgEntry(c, cache);
      if (entry && entry.programs && entry.programs.length > matchedPrograms.length) {
        matchedPrograms = entry.programs;
        found = true;
      }
    }

    if (found && matchedPrograms.length > 0) {
      return matchedPrograms.map((prog: any) => {
        return `  <programme start="${escapeXml(prog.start)}" stop="${escapeXml(prog.stop)}" channel="${epgIdEscaped}">\n    <title lang="zh">${escapeXml(prog.title)}</title>\n    ${prog.desc ? `<desc lang="zh">${escapeXml(prog.desc)}</desc>` : ""}\n  </programme>`;
      }).join("\n");
    } else {
      return "";
    }
  }).join("\n");

  const xmlFooter = `</tv>`;
  const fullXml = `${xmlHeader}\n${channelTags}\n${programTags}\n${xmlFooter}`;
  const gzBuffer = zlib.gzipSync(Buffer.from(fullXml, "utf-8"));

  const etag = `W/"epg-${now}-${gzBuffer.length}"`;

  integratedEpgXmlCache = fullXml;
  integratedEpgXmlGzCache = gzBuffer;
  integratedEpgCacheTime = now;
  integratedEpgEtag = etag;

  // Persist to disk file cache
  try {
    fs.writeFileSync(EPG_EXPORT_XML_PATH, fullXml, "utf-8");
    fs.writeFileSync(EPG_EXPORT_GZ_PATH, gzBuffer);
  } catch (err) {
    console.error("[EPG DISK CACHE WRITE ERROR]", err);
  }

  return { xml: fullXml, gz: gzBuffer, etag };
}

function escapeXml(unsafe: string): string {
  if (!unsafe) return "";
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "'": return "&apos;";
      case "\"": return "&quot;";
      default: return c;
    }
  });
}

let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("请先在 系统设置 > 密钥 (Settings > Secrets) 中配置您的 GEMINI_API_KEY！");
  }
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        }
      }
    });
  }
  return geminiClient;
}

const ipGeoCache = new Map<string, { province: string, isp: string }>();

async function getClientIpGeo(ipString: string): Promise<{ province: string, isp: string }> {
  let ip = (ipString || "").trim();
  if (ip.includes("::ffff:")) {
    ip = ip.replace("::ffff:", "");
  }
  if (!ip || ip === "127.0.0.1" || ip === "::1" || ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("172.16.") || ip.startsWith("172.17.") || ip.startsWith("172.18.") || ip.startsWith("172.19.") || ip.startsWith("172.2") || ip.startsWith("172.3")) {
    return { province: "", isp: "" };
  }

  if (ipGeoCache.has(ip)) {
    return ipGeoCache.get(ip)!;
  }

  const enabledApis = ipGeoApis.filter(a => a.enabled);
  if (enabledApis.length === 0) return { province: "", isp: "" };

  const provinces = ["北京", "上海", "天津", "重庆", "河北", "山西", "辽宁", "吉林", "黑龙江", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "海南", "四川", "贵州", "云南", "陕西", "甘肃", "青海", "台湾", "内蒙古", "广西", "西藏", "宁夏", "新疆", "香港", "澳门"];
  const ispKeywords = [
    { keyword: "telecom", name: "电信" },
    { keyword: "unicom", name: "联通" },
    { keyword: "mobile", name: "移动" },
    { keyword: "chinanet", name: "电信" },
    { keyword: "broadband", name: "广电" },
    { keyword: "cantv", name: "广电" },
    { keyword: "chinasat", name: "广电" },
    { keyword: "电信", name: "电信" },
    { keyword: "联通", name: "联通" },
    { keyword: "移动", name: "移动" },
    { keyword: "铁通", name: "铁通" },
    { keyword: "广电", name: "广电" }
  ];

  for (const api of enabledApis) {
    try {
      const url = api.url.replace("{{ip}}", ip);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const buffer = await res.arrayBuffer();
        let text = "";
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
        } catch (e) {
          text = new TextDecoder("gbk").decode(buffer);
        }

        const rawLower = text.toLowerCase();
        let matchedProvince = "";
        for (const p of provinces) {
          if (rawLower.includes(p.toLowerCase())) {
            matchedProvince = p;
            break;
          }
        }

        let matchedIsp = "";
        for (const ik of ispKeywords) {
          if (rawLower.includes(ik.keyword.toLowerCase())) {
            matchedIsp = ik.name;
            break;
          }
        }

        if (matchedProvince || matchedIsp) {
          const geo = { province: matchedProvince, isp: matchedIsp };
          ipGeoCache.set(ip, geo);
          console.log(`[IP GEO LOOKUP] Resolved IP ${ip} via ${api.name}: province=${geo.province}, isp=${geo.isp}`);
          
          // Reset failCount on success
          if (api.failCount && api.failCount > 0) {
            api.failCount = 0;
            saveData();
          }

          return geo;
        }
      } else {
        throw new Error(`HTTP Error ${res.status}`);
      }
    } catch (err: any) {
      console.error(`[IP GEO LOOKUP ERROR] API ${api.name} for ${ip}: ${err.message || err}`);
      
      // Increment failCount and disable if >= 3
      api.failCount = (api.failCount || 0) + 1;
      if (api.failCount >= 3) {
        console.warn(`[IP GEO LOOKUP] Auto-disabling API ${api.name} due to ${api.failCount} consecutive failures.`);
        api.enabled = false;
      }
      saveData();
    }

    if (!autoSwitchGeoApi) break;
  }

  return { province: "", isp: "" };
}

function sortSourcesByGeo(sources: LiveSource[], clientProvince: string, clientIsp: string): LiveSource[] {
  if (!clientProvince && !clientIsp) return sources;
  
  return [...sources].sort((a, b) => {
    const getScore = (s: LiveSource) => {
      let score = 0;
      const srcProv = (s.province || "").trim();
      const srcIsp = (s.isp || "").trim();

      const normSrcProv = srcProv.replace(/省|市|自治区|特别行政区/g, "");
      const normClientProv = clientProvince.replace(/省|市|自治区|特别行政区/g, "");
      const provinceMatch = normClientProv && normSrcProv && (normSrcProv.includes(normClientProv) || normClientProv.includes(normSrcProv));
      
      const normSrcIsp = srcIsp.replace("中国", "");
      const normClientIsp = clientIsp.replace("中国", "");
      const ispMatch = normClientIsp && normSrcIsp && (normSrcIsp.includes(normClientIsp) || normClientIsp.includes(normSrcIsp));

      if (provinceMatch && ispMatch) {
        score += 100; // Exact province + ISP match
      } else if (provinceMatch) {
        score += 50;  // Province match only
      } else if (ispMatch && (srcProv === "全国" || !srcProv)) {
        score += 30;  // Nationwide + ISP match
      } else if (srcProv === "全国" || !srcProv) {
        score += 10;  // Nationwide only
      } else if (ispMatch) {
        score += 5;   // ISP match other province
      } else {
        score += 1;   // No match
      }

      // Priority bonus for RTSP lines (ISP dedicated high quality streams)
      if ((s.url || "").trim().toLowerCase().startsWith("rtsp://")) {
        score += 200;
      }

      return score;
    };

    return getScore(b) - getScore(a);
  });
}

function sortSourcesForExport(sources: LiveSource[]): LiveSource[] {
  return [...sources].sort((a, b) => {
    // 1. Status weight: active (3) > unknown/checking (2) > inactive (1)
    const statusWeightA = a.status === "active" ? 3 : (a.status === "inactive" ? 1 : 2);
    const statusWeightB = b.status === "active" ? 3 : (b.status === "inactive" ? 1 : 2);
    if (statusWeightA !== statusWeightB) {
      return statusWeightB - statusWeightA;
    }

    // 2. Protocol weight: RTSP lines get top priority because they are ISP-specific dedicated streams with higher quality
    const isRtspA = (a.url || "").trim().toLowerCase().startsWith("rtsp://");
    const isRtspB = (b.url || "").trim().toLowerCase().startsWith("rtsp://");
    if (isRtspA !== isRtspB) {
      return isRtspA ? -1 : 1;
    }

    // 3. Latency weight: lower latency is better
    const latencyA = a.latency && a.latency > 0 ? a.latency : 9999;
    const latencyB = b.latency && b.latency > 0 ? b.latency : 9999;
    return latencyA - latencyB;
  });
}

function getPlayableSources(sources: LiveSource[], targetIsp: string, targetProvince: string): LiveSource[] {
  let filtered = [...sources].filter(s => !s.isolated);
  
  if (targetIsp) {
    const normTargetIsp = targetIsp.trim();
    filtered = filtered.filter(src => {
      let srcIsp = (src.isp || "").trim();
      
      // Auto-detect ISP from URL if empty or "其它"
      if (!srcIsp || srcIsp === "其它" || srcIsp === "其他") {
        const urlLower = (src.url || "").toLowerCase();
        if (urlLower.includes("chinamobile") || urlLower.includes("cmvideo") || urlLower.includes("cmcc") || urlLower.includes(".yd.") || urlLower.includes("migu")) {
          srcIsp = "移动";
        } else if (urlLower.includes("chinanet") || urlLower.includes("ctcc") || urlLower.includes("telecom") || urlLower.includes(".dx.")) {
          srcIsp = "电信";
        } else if (urlLower.includes("unicom") || urlLower.includes("cucc") || urlLower.includes(".lt.")) {
          srcIsp = "联通";
        } else if (urlLower.includes("cbn") || urlLower.includes("broadcasting") || urlLower.includes("guangdian")) {
          srcIsp = "广电";
        }
      }

      if (!srcIsp || srcIsp === "其它" || srcIsp === "其他") {
        return true;
      }
      const isBGP = srcIsp.toUpperCase().includes("BGP") || srcIsp.toUpperCase().includes("BPG");
      if (isBGP) {
        return true;
      }
      const sIsp = srcIsp.replace("中国", "");
      const tIsp = normTargetIsp.replace("中国", "");
      
      // Prevent empty string match if replace caused it
      if (!sIsp) return true;

      if (sIsp.includes(tIsp) || tIsp.includes(sIsp)) {
        return true;
      }
      return false;
    });
  }

  if (targetIsp || targetProvince) {
    filtered = sortSourcesByGeo(filtered, targetProvince, targetIsp);
  }

  return filtered;
}

async function fetchBufferWithFallback(urlStr: string, userAgent: string): Promise<{ buffer: Buffer; isGzipped: boolean }> {
  const downloadDirectly = (targetUrlStr: string, maxRedirects = 5): Promise<{ buffer: Buffer; isGzipped: boolean }> => {
    return new Promise((resolve, reject) => {
      if (maxRedirects < 0) {
        return reject(new Error("Too many redirects (max 5 redirects allowed)"));
      }
      try {
        const parsedUrl = new URL(targetUrlStr);
        const isHttps = parsedUrl.protocol === "https:";
        const httpClient = isHttps ? https : http;

        const headers: Record<string, string> = {
          "User-Agent": userAgent,
          "Accept-Encoding": "gzip, deflate, br",
          "Accept": "*/*"
        };

        const options: any = {
          method: "GET",
          headers,
          timeout: 45000,
        };

        if (isHttps) {
          options.rejectUnauthorized = false; // Bypass all certificate failures (expired, self-signed, host mismatch, etc.)
        }

        const req = httpClient.request(parsedUrl, options, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, parsedUrl.href).href;
            console.log(`[EPG SYNC RECOVERY] Following redirect: ${targetUrlStr} -> ${redirectUrl}`);
            return downloadDirectly(redirectUrl, maxRedirects - 1).then(resolve).catch(reject);
          }

          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`HTTP Error ${res.statusCode}`));
          }

          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            const buffer = Buffer.concat(chunks);
            const contentEncoding = res.headers["content-encoding"] || "";
            const isGzipped = (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b);
            resolve({ buffer, isGzipped });
          });
        });

        req.on("error", (err) => {
          reject(err);
        });

        req.on("timeout", () => {
          req.destroy();
          reject(new Error("EPG Sync request timeout (45s)"));
        });

        req.end();
      } catch (err) {
        reject(err);
      }
    });
  };

  try {
    const res = await fetch(urlStr, {
      headers: { "User-Agent": userAgent },
    });
    if (!res.ok) {
      throw new Error(`HTTP Error ${res.status}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentEncoding = res.headers.get("content-encoding") || "";
    const isGzipped = (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b);
    return { buffer, isGzipped };
  } catch (fetchErr: any) {
    console.log(`[EPG SYNC] Standard fetch failed for ${urlStr}: ${fetchErr.message || fetchErr}. Attempting recovery via bypass direct fetch...`);
    try {
      return await downloadDirectly(urlStr);
    } catch (fallbackErr: any) {
      console.error(`[EPG SYNC RECOVERY FAILED] ${urlStr}: ${fallbackErr.message || fallbackErr}`);
      throw new Error(fallbackErr.message || "Fetch failed");
    }
  }
}

async function performEpgSync(source: EpgSource): Promise<boolean> {
  try {
    let targetUrl = source.url;
    if (targetUrl.includes("github.com") && !targetUrl.includes("raw.githubusercontent.com") && !targetUrl.includes("/raw/")) {
      targetUrl = targetUrl
        .replace("github.com", "raw.githubusercontent.com")
        .replace("/blob/", "/");
    }
    if (githubProxy && (targetUrl.includes("github.com") || targetUrl.includes("githubusercontent.com"))) {
      const proxyPrefix = githubProxy.endsWith("/") ? githubProxy : `${githubProxy}/`;
      targetUrl = `${proxyPrefix}${targetUrl}`;
    }
    console.log(`[EPG SYNC] Fetching ${source.name} from: ${targetUrl}`);
    
    const { buffer, isGzipped } = await fetchBufferWithFallback(targetUrl, "IPTV-Manager-EPG-Sync-Service");
                     
    let xmlText = "";
    if (isGzipped) {
      console.log(`[EPG SYNC] Detected Gzip compression for ${source.name}. Decompressing...`);
      try {
        const decompressed = zlib.gunzipSync(buffer);
        xmlText = decompressed.toString("utf-8");
      } catch (gzErr: any) {
        throw new Error(`Gzip decompression failed: ${gzErr.message}`);
      }
    } else {
      xmlText = buffer.toString("utf-8");
    }

    if (!xmlText.trim().startsWith("<?xml") && !xmlText.includes("<tv")) {
      throw new Error("Invalid EPG XML content, missing <tv> root");
    }
    console.log(`[EPG SYNC] Parsing XML of length ${xmlText.length}...`);
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: ""
    });
    const parsed = parser.parse(xmlText);
    const channelMap: Record<string, { displayNames: string[], programs: { start: string, stop: string, title: string, desc: string }[] }> = {};
    const channelsList = ensureArray(parsed?.tv?.channel);
    for (const ch of channelsList) {
      const originalId = (ch as any).id;
      if (!originalId) continue;
      const displayNamesList = ensureArray((ch as any)["display-name"]).map(d => getText(d).trim()).filter(Boolean);
      channelMap[originalId] = {
        displayNames: displayNamesList,
        programs: []
      };
    }
    const programmesList = ensureArray(parsed?.tv?.programme);
    for (const prog of programmesList) {
      const chId = (prog as any).channel;
      if (!chId) continue;
      const start = (prog as any).start || "";
      const stop = (prog as any).stop || "";
      const title = getText((prog as any).title);
      const desc = getText((prog as any).desc);
      if (!channelMap[chId]) {
        channelMap[chId] = { displayNames: [], programs: [] };
      }
      channelMap[chId].programs.push({ start, stop, title, desc });
    }
    if (!fs.existsSync(EPG_CACHE_DIR)) {
      fs.mkdirSync(EPG_CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(
      path.join(EPG_CACHE_DIR, `${source.id}.json`),
      JSON.stringify(channelMap, null, 2),
      "utf-8"
    );
    delete loadedEpgCaches[source.id]; // invalidate memory cache
    invalidateIntegratedEpgCache();
    source.status = "success";
    source.lastSynced = new Date().toISOString();
    source.message = `同步成功，共导入 ${Object.keys(channelMap).length} 个频道节目源`;
    saveData();
    return true;
  } catch (error: any) {
    console.error(`[EPG SYNC ERROR] ${source.name}:`, error.message);
    source.status = "failed";
    source.message = error.message;
    source.lastSynced = new Date().toISOString();
    saveData();
    return false;
  }
}

// Synchronizer for M3U and TXT
async function performSync(config: SyncConfig, force = false) {
  try {
    // Process Github URL: converts github.com/user/repo/blob/branch/file to raw.githubusercontent.com
    let targetUrl = config.url;
    if (targetUrl.includes("github.com") && !targetUrl.includes("raw.githubusercontent.com")) {
      targetUrl = targetUrl
        .replace("github.com", "raw.githubusercontent.com")
        .replace("/blob/", "/");
    }

    // Apply GitHub Proxy if configured
    if (githubProxy && (targetUrl.includes("github.com") || targetUrl.includes("githubusercontent.com"))) {
      const proxyPrefix = githubProxy.endsWith("/") ? githubProxy : `${githubProxy}/`;
      targetUrl = `${proxyPrefix}${targetUrl}`;
    }

    console.log(`[SUBSCRIPTION SYNC] Fetching ${config.name} from: ${targetUrl}`);
    const { buffer, isGzipped } = await fetchBufferWithFallback(targetUrl, "IPTV-Manager-Sync-Service");

    let content = "";
    if (isGzipped) {
      try {
        content = zlib.gunzipSync(buffer).toString("utf-8");
      } catch (e) {
        content = buffer.toString("utf-8");
      }
    } else {
      content = buffer.toString("utf-8");
    }

    // Track update status by computing md5 checksum
    const freshHash = crypto.createHash("md5").update(content).digest("hex");
    if (!force && config.contentHash && config.contentHash === freshHash) {
      console.log(`[SUBSCRIPTION SYNC] No update detected for ${config.name}. Content hash matches.`);
      config.status = "success";
      config.lastSynced = new Date().toISOString();
      config.message = "同步完成 (检测到内容无新变化)";
      config.consecutiveFailures = 0;
      saveData();
      return true;
    }

    let importedChannelsCount = 0;
    let importedSourcesCount = 0;

    if (config.type === "m3u" || content.includes("#EXTM3U")) {
      // Parse M3U
      const lines = content.split(/\r?\n/);
      let currentInfo: {
        name: string;
        logo: string;
        category: string;
        alias: string[];
        epgId: string;
      } | null = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("#EXTINF:")) {
          // Parse #EXTINF Properties
          // Extended metadata extraction using dynamic regex
          const logoMatch = line.match(/tvg-logo="([^"]+)"/) || line.match(/logo="([^"]+)"/);
          const groupMatch = line.match(/group-title="([^"]+)"/);
          const epgMatch = line.match(/tvg-id="([^"]+)"/) || line.match(/epg-id="([^"]+)"/);
          const tvgNameMatch = line.match(/tvg-name="([^"]+)"/);
          const aliasMatch = line.match(/tvg-alias="([^"]+)"/) || line.match(/alias="([^"]+)"/) || line.match(/alias-name="([^"]+)"/);
          
          let name = "未知频道";
          const lastQuoteIndex = line.lastIndexOf('"');
          if (lastQuoteIndex !== -1) {
            const commaAfterQuotes = line.indexOf(",", lastQuoteIndex);
            if (commaAfterQuotes !== -1) {
              name = line.substring(commaAfterQuotes + 1).trim();
            } else {
              const commaIndex = line.lastIndexOf(",");
              if (commaIndex !== -1) name = line.substring(commaIndex + 1).trim();
            }
          } else {
            const commaIndex = line.indexOf(",");
            if (commaIndex !== -1) name = line.substring(commaIndex + 1).trim();
          }
          name = stripBitrateAndResolution(name);

          if (name.includes("线路")) {
            currentInfo = null;
            continue;
          }

          const nameParts = name.split(/[,;，；:]/).map(s => s.trim()).filter(Boolean);
          if (nameParts.length > 0) {
            name = nameParts[0];
          }

          let parsedAliases = [...nameParts];
          if (tvgNameMatch && tvgNameMatch[1]) {
            parsedAliases.push(...tvgNameMatch[1].split(/[,;，；:]/).map(s => s.trim()).filter(Boolean));
          }
          if (aliasMatch && aliasMatch[1]) {
            parsedAliases.push(...aliasMatch[1].split(/[,;，；:]/).map(s => s.trim()).filter(Boolean));
          }
          parsedAliases = Array.from(new Set(parsedAliases));

          currentInfo = {
            name,
            logo: logoMatch ? logoMatch[1] : "",
            category: groupMatch ? groupMatch[1] : "其它频道",
            alias: parsedAliases,
            epgId: epgMatch ? epgMatch[1] : generateDefaultEpgId(name),
          };
        } else if (line && !line.startsWith("#") && currentInfo) {
          // Play stream URL matching current channel
          let url = line.split("$")[0].trim();
          const { province, isp: parsedIsp } = parseIspAndProvince(currentInfo.name + " " + currentInfo.category);
          const isp = config.isp ? config.isp : parsedIsp;

          let isCarouselM3u = false;
          let carouselKeyM3u = null;
          const parsedCarouselM3u = parseCarouselUrl(url);
          if (parsedCarouselM3u.platform && parsedCarouselM3u.originalId) {
             isCarouselM3u = true;
             carouselKeyM3u = `@carousel:${parsedCarouselM3u.platform}_${parsedCarouselM3u.originalId}`;
             const registry = db.prepare("SELECT name FROM carousel_channels WHERE platform = ? AND originalId = ?").get(parsedCarouselM3u.platform, parsedCarouselM3u.originalId) as any;
             if (registry) {
               currentInfo.name = registry.name;
             }
             detectAndRegisterCarouselProxy(url);
          }

          // Find or create correct Group entities for this category (comma/semicolon split for many-to-many relationship)
          const catNames = (isCarouselM3u ? ["轮播频道"] : currentInfo.category.split(/[,;，；]/)).map(s => s.trim()).filter(Boolean);
          if (catNames.length === 0) catNames.push("其它频道");
          
          const matchedGroupIds: string[] = [];
          for (const catName of catNames) {
            let existingGroup = groups.find(g => g.name.toLowerCase() === catName.toLowerCase());
            if (!existingGroup) {
              if (autoCreateChannel) {
                existingGroup = {
                  id: "g_" + Math.random().toString(36).substring(2, 10),
                  name: catName,
                };
                groups.push(existingGroup);
                matchedGroupIds.push(existingGroup.id);
              }
            } else {
              matchedGroupIds.push(existingGroup.id);
            }
          }

          // Find standard template/alias group from default aliases
          const stdInfo = findAliasTemplate(currentInfo!.name);
          const lookupName = stdInfo ? stdInfo.templateName : currentInfo!.name;

          // Find existing channel by name, standard template name, or any associated alias
          let channel = channels.find(
            (c) => {
              if (typeof carouselKeyM3u !== 'undefined' && carouselKeyM3u) return c.alias.includes(carouselKeyM3u);
              return normalizeChannelName(c.name) === normalizeChannelName(lookupName) ||
              c.alias.some((a) => normalizeChannelName(a) === normalizeChannelName(lookupName)) ||
              (stdInfo && stdInfo.aliases.some(a => normalizeChannelName(c.name) === normalizeChannelName(a) || c.alias.some(ca => normalizeChannelName(ca) === normalizeChannelName(a))))
            }
          );

          if (!channel) {
            if (!autoCreateChannel || config.aliasOnly) {
              currentInfo = null; // reset
              continue;
            }
            const channelId = "ch_" + Math.random().toString(36).substring(2, 10);
            const cleanName = stdInfo ? stdInfo.templateName : currentInfo!.name;
            const cleanAliases = stdInfo 
              ? Array.from(new Set([cleanName, currentInfo!.name, ...stdInfo.aliases]))
              : currentInfo!.alias;

            channel = {
              id: channelId,
              name: cleanName,
              logo: currentInfo!.logo || "https://images.unsplash.com/photo-1598257006458-087169a1f08d?auto=format&fit=crop&w=48&h=48&q=80",
              groupIds: matchedGroupIds,
              alias: cleanAliases,
              epgId: "",
              sources: [],
            };
            channels.push(channel);
            importedChannelsCount++;
          } else {
            // Auto pre-populate missing aliases from standard configuration
            if (stdInfo) {
              stdInfo.aliases.forEach(a => {
                if (!channel!.alias.includes(a)) {
                  channel!.alias.push(a);
                }
              });
            }
            // Add any aliases parsed from the current m3u metadata
            if (currentInfo && currentInfo.alias) {
              currentInfo.alias.forEach(a => {
                if (!channel!.alias.includes(a)) {
                  channel!.alias.push(a);
                }
              });
            }
            // Update logo if provided in the M3U and current logo is invalid or system-generated
            if (currentInfo!.logo && (!channel!.logo || channel!.logo.includes("unsplash.com"))) {
              channel!.logo = currentInfo!.logo;
            }
          }

          if (config.aliasOnly) {
            currentInfo = null;
            continue;
          }

          // Add source if URL not already there
          const existingSrc = channel.sources.find((s) => s.url === url);
          if (!existingSrc) {
            channel.sources.push({
              id: "src_" + Math.random().toString(36).substring(2, 10),
              url,
              province,
              isp,
              status: "unknown",
            });
            importedSourcesCount++;
          } else if (config.isp) {
            existingSrc.isp = config.isp;
          }

          currentInfo = null; // reset
        }
      }
    } else {
      // Parse Custom TVBox TXT format
      // Category,#genre
      // Channel,url1
      // Channel2#电信,url2
      const lines = content.split(/\r?\n/);
      let currentCategory = "其它频道";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        if (line.includes(",#genre")) {
          currentCategory = line.split(",")[0].trim();
        } else if (line.includes(",")) {
          const parts = line.split(",");
          const nameWithSpecs = parts[0].trim();
          const urls = parts[1].split('#').map(u => {
            let u2 = u.trim();
            if (u2.includes('$')) u2 = u2.split('$')[0].trim();
            return u2;
          }).filter(Boolean);
          if (urls.length === 0) continue;

          const { province, isp: parsedIsp } = parseIspAndProvince(nameWithSpecs + " " + currentCategory);
          const isp = config.isp ? config.isp : parsedIsp;
          // Strip ISP and specifications from standard channel title
          let name = nameWithSpecs.split("#")[0].trim();
          name = stripBitrateAndResolution(name);

          if (name.includes("线路")) {
            continue;
          }

          const nameParts = name.split(/[,;，；:]/).map(s => s.trim()).filter(Boolean);
          if (nameParts.length > 0) {
            name = nameParts[0];
          }

          // Resolve group
          const catNames = currentCategory.split(/[,;，；]/).map(s => s.trim()).filter(Boolean);
          if (catNames.length === 0) catNames.push("其它频道");

          const matchedGroupIds: string[] = [];
          for (const catName of catNames) {
            let existingGroup = groups.find(g => g.name.toLowerCase() === catName.toLowerCase());
            if (!existingGroup) {
              if (autoCreateChannel) {
                existingGroup = {
                  id: "g_" + Math.random().toString(36).substring(2, 10),
                  name: catName,
                };
                groups.push(existingGroup);
                matchedGroupIds.push(existingGroup.id);
              }
            } else {
              matchedGroupIds.push(existingGroup.id);
            }
          }

          const stdInfo = findAliasTemplate(name);
          const lookupName = stdInfo ? stdInfo.templateName : name;

          let channel = channels.find(
            (c) =>
              normalizeChannelName(c.name) === normalizeChannelName(lookupName) ||
              c.alias.some((a) => normalizeChannelName(a) === normalizeChannelName(lookupName)) ||
              (stdInfo && stdInfo.aliases.some(a => normalizeChannelName(c.name) === normalizeChannelName(a) || c.alias.some(ca => normalizeChannelName(ca) === normalizeChannelName(a))))
          );

          if (!channel) {
            if (!autoCreateChannel || config.aliasOnly) {
              continue;
            }
            const channelId = "ch_" + Math.random().toString(36).substring(2, 10);
            const cleanName = stdInfo ? stdInfo.templateName : name;
            const cleanAliases = stdInfo 
              ? Array.from(new Set([cleanName, ...nameParts, ...stdInfo.aliases]))
              : Array.from(new Set(nameParts));

            channel = {
              id: channelId,
              name: cleanName,
              logo: "https://images.unsplash.com/photo-1598257006458-087169a1f08d?auto=format&fit=crop&w=48&h=48&q=80",
              groupIds: matchedGroupIds,
              alias: cleanAliases,
              epgId: generateDefaultEpgId(cleanName),
              sources: [],
            };
            channels.push(channel);
            importedChannelsCount++;
          } else {
            if (stdInfo) {
              // FORCE UPDATE channel name to the official alias template name
              channel.name = stdInfo.templateName;
              stdInfo.aliases.forEach(a => {
                if (!channel!.alias.includes(a)) {
                  channel!.alias.push(a);
                }
              });
            }
            // Add any aliases parsed from the current TXT metadata
            nameParts.forEach(a => {
              if (!channel!.alias.includes(a)) {
                channel!.alias.push(a);
              }
            });
            channel!.alias = Array.from(new Set(channel!.alias));
          }

          if (config.aliasOnly) {
            continue;
          }

          for (const url of urls) {
            const existingSrc = channel.sources.find((s) => s.url === url);
            if (!existingSrc) {
              channel.sources.push({
                id: "src_" + Math.random().toString(36).substring(2, 10),
                url,
                province,
                isp,
                status: "unknown",
              });
              importedSourcesCount++;
              detectAndRegisterCarouselProxy(url);
            } else if (config.isp) {
              existingSrc.isp = config.isp;
              detectAndRegisterCarouselProxy(url);
            }
          }
        }
      }
    }

    config.contentHash = freshHash;
    config.status = "success";
    config.lastSynced = new Date().toISOString();
    config.message = `成功导入 ${importedChannelsCount} 个频道，${importedSourcesCount} 个新直播源`;
    config.consecutiveFailures = 0;
    saveData();
    return true;
  } catch (err: any) {
    config.consecutiveFailures = (config.consecutiveFailures || 0) + 1;
    config.status = "failed";
    config.lastSynced = new Date().toISOString();
    if (config.consecutiveFailures >= 3) {
      config.disabled = true;
      config.message = `连续导入失败 ${config.consecutiveFailures} 次，已自动禁用: ${err.message || err}`;
    } else {
      config.message = `同步失败 (连续第 ${config.consecutiveFailures} 次失败): ${err.message || err}`;
    }
    saveData();
    return false;
  }
}


function calculateNextRun(startTime: string, intervalMinutes: number, lastRunStr: string | null): string {
  const now = new Date();
  let nextRunTime = new Date();
  
  if (startTime) {
    const [hours, minutes] = startTime.split(':').map(Number);
    nextRunTime.setHours(hours, minutes, 0, 0);
    
    // If nextRunTime is in the past, add intervals until it's in the future
    while (nextRunTime <= now) {
      if (intervalMinutes && intervalMinutes > 0) {
        nextRunTime.setTime(nextRunTime.getTime() + intervalMinutes * 60 * 1000);
      } else {
        nextRunTime.setDate(nextRunTime.getDate() + 1);
      }
    }
  } else if (intervalMinutes && intervalMinutes > 0) {
    if (lastRunStr) {
      nextRunTime = new Date(new Date(lastRunStr).getTime() + intervalMinutes * 60 * 1000);
      if (nextRunTime <= now) {
         nextRunTime = new Date(now.getTime() + intervalMinutes * 60 * 1000);
      }
    } else {
      nextRunTime = new Date(now.getTime() + intervalMinutes * 60 * 1000);
    }
  } else {
    nextRunTime.setDate(nextRunTime.getDate() + 1);
  }

  return nextRunTime.toISOString();
}

async function runCronJob(job: any) {
  const nowStr = new Date().toISOString();
  // Update nextRun immediately to prevent concurrent triggers by setInterval
  const nextRun = calculateNextRun(job.startTime, job.intervalMinutes, nowStr);
  db.prepare("UPDATE cron_jobs SET lastRun = ?, nextRun = ? WHERE id = ?").run(nowStr, nextRun, job.id);
  
  const insertLog = db.prepare("INSERT INTO cron_logs (id, jobId, runAt, status, message) VALUES (?, ?, ?, ?, ?)");
  const logId = Math.random().toString(36).substring(2, 10);
  
  try {
    if (job.id === "job_epg_sync") {
      let successCount = 0;
      const activeSources = epgSources.filter((s) => s.active);
      for (const source of activeSources) {
        const success = await performEpgSync(source);
        if (success) successCount++;
      }
      insertLog.run(logId, job.id, nowStr, "success", `成功同步 ${successCount}/${activeSources.length} 个 EPG 源`);
    } else if (job.id === "job_github_import") {
      let successCount = 0;
      const activeConfigs = syncConfigs.filter((c) => !c.disabled);
      for (const config of activeConfigs) {
        const success = await performSync(config);
        if (success) successCount++;
      }
      insertLog.run(logId, job.id, nowStr, "success", `成功同步 ${successCount}/${activeConfigs.length} 个 GitHub 订阅源`);
    } else if (job.id === "job_carousel_test") {
      let testedCount = 0;
      let activeCount = 0;
      const proxies = db.prepare('SELECT * FROM carousel_proxies').all() as any[];
      if (proxies.length > 0) {
         const fallbacks: Record<string, string> = { "yy": "12345", "douyu": "9999", "huya": "lpl", "migu": "631780532", "bilibili": "6", "cntv": "cctv1" };
         const channels = db.prepare('SELECT platform, originalId FROM carousel_channels GROUP BY platform').all() as any[];
         for (const c of channels) {
            if (c.platform && c.originalId) {
               fallbacks[c.platform.toLowerCase()] = c.originalId;
            }
         }
         
         for (const proxy of proxies) {
            const plat = (proxy.platform || '').toLowerCase();
            if (isUrlBlockedByDisabledRules(proxy.urlTemplate, plat)) {
               db.prepare('UPDATE carousel_proxies SET status = ? WHERE id = ?').run('inactive', proxy.id);
               continue;
            }

            const originalId = fallbacks[plat];
            if (!originalId) continue;
            
            const url = proxy.urlTemplate.replace(/\{\s*(?:id|roomid|channelid|cid|originalid)?\s*\}/gi, originalId);
            let isOk = false;
            try {
               const controller = new AbortController();
               const timeoutId = setTimeout(() => controller.abort(), 6000);
               const res = await fetch(url, { method: 'GET', signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
               clearTimeout(timeoutId);
               if (res.ok) isOk = true;
            } catch(e) {
               isOk = false;
            }
            
            db.prepare('UPDATE carousel_proxies SET status = ? WHERE id = ?').run(isOk ? 'active' : 'inactive', proxy.id);
            if (isOk) activeCount++;
            testedCount++;
         }
      }
      const syncStats = syncCarouselSources();
      insertLog.run(logId, job.id, nowStr, "success", `成功检测了 ${testedCount} 个轮播代理（有效: ${activeCount}），并同步生成 ${syncStats.createdCount} 个新源，覆盖 ${syncStats.channelsCount} 个频道`);
    } else if (job.id === "job_server_test") {
      if (testStatus.status === "running") {
        insertLog.run(logId, job.id, nowStr, "failed", "当前已有测速任务在运行，跳过定时测速");
      } else {
        let targetSources: { id: string; channelId: string; url: string }[] = [];
        channels.forEach((channel) => {
          if (channel.isolated) return;
          if (!channel.sources) return;
          channel.sources.forEach((source) => {
            if (source.isolated) return;
            const specificISPs = ["电信", "联通", "移动", "广电", "铁通"];
            if (source.isp && specificISPs.includes(source.isp)) return;
            targetSources.push({
              id: source.id,
              channelId: channel.id,
              url: source.url,
            });
          });
        });
        if (targetSources.length > 0) {
          await runConcurrentTest(targetSources, 8);
          insertLog.run(logId, job.id, nowStr, "success", `成功对 ${targetSources.length} 个直播源进行了测速`);
        } else {
          insertLog.run(logId, job.id, nowStr, "success", "没有符合测速条件的直播源");
        }
      }
    } else {
      insertLog.run(logId, job.id, nowStr, "failed", "未知的定时任务 ID");
    }
  } catch (err: any) {
    insertLog.run(logId, job.id, nowStr, "failed", err.message || "执行失败");
  }
}

// Background Cron-like Scheduler to perform Scheduled Sync
setInterval(async () => {
  const now = new Date();
  const nowStr = now.toISOString();
  
  // Periodically check and perform daily backups to prevent accidental loss
  checkAndPerformDailyBackup();

  // Run new cron jobs
  const jobs = db.prepare("SELECT * FROM cron_jobs WHERE active = 1").all() as any[];
  for (const job of jobs) {
    if (!job.nextRun || new Date(job.nextRun) <= now) {
      console.log(`Starting scheduled cron job: ${job.name}`);
      await runCronJob(job);
    }
  }

}, 60 * 1000); // Check tasks every minute


// Express Setup Configuration
function preGenerateIspPlaylists() {
  const isps = ["", "电信", "联通", "移动", "广电", "BGP"];
  console.log("[CACHE] Pre-generating standard ISP playlists to data/playlists_export...");
  const baseUrl = "http://localhost:3000";
  for (const isp of isps) {
    // Generate both m3u and txt
    for (const format of ["m3u", "txt"]) {
      const cacheParams = {
        format: format as "m3u" | "txt",
        isp: isp || undefined,
        baseUrl
      };
      
      getOrGeneratePlaylistExport(cacheParams, () => {
        if (format === "m3u") {
          let playlistRows = [`#EXTM3U x-tvg-url="${baseUrl}/api/export/epg.xml.gz"`];
          const orderedGroups = [...groups, { id: "g_other", name: "其它频道" }];
          orderedGroups.forEach((group) => {
            if (group.isolated) return;
            channels.forEach((channel) => {
              if (channel.isolated) return;
              const isInGroup = channel.groupIds.includes(group.id);
              const isFallback = group.id === "g_other" && (channel.groupIds.length === 0 || !channel.groupIds.some(id => groups.find(g => g.id === id)));
              if (!isInGroup && !isFallback) return;
              
              let processedSources = channel.sources;
              processedSources = getPlayableSources(processedSources, isp, "");
              processedSources = processedSources.filter(source => source.status === "active");
              processedSources = sortSourcesForExport(processedSources);
              
              const sourcesToExport = processedSources.slice(0, 15);
              sourcesToExport.forEach(bestSource => {
                playlistRows.push(
                  `#EXTINF:-1 tvg-id="${channel.epgId}" tvg-name="${channel.name}" tvg-logo="${channel.logo}" group-title="${group.name}",${channel.name}`
                );
                playlistRows.push(bestSource.url);
              });
            });
          });
          return playlistRows.join("\n");
        } else {
          let playlistRows: string[] = [];
          const orderedGroups = [...groups, { id: "g_other", name: "其它频道" }];
          orderedGroups.forEach((group) => {
            if (group.isolated) return;
            let groupChannels: string[] = [];
            
            channels.forEach((channel) => {
              if (channel.isolated) return;
              const isInGroup = channel.groupIds.includes(group.id);
              const isFallback = group.id === "g_other" && (channel.groupIds.length === 0 || !channel.groupIds.some(id => groups.find(g => g.id === id)));
              if (!isInGroup && !isFallback) return;
              
              let processedSources = channel.sources;
              processedSources = getPlayableSources(processedSources, isp, "");
              processedSources = processedSources.filter(source => source.status === "active");
              processedSources = sortSourcesForExport(processedSources);
              
              const sourcesToExport = processedSources.slice(0, 15);
              if (sourcesToExport.length > 0) {
                const urls = sourcesToExport.map(s => s.url).join("#");
                groupChannels.push(`${channel.name},${urls}`);
              }
            });
            if (groupChannels.length > 0) {
              playlistRows.push(`${group.name},#genre#`);
              playlistRows.push(...groupChannels);
            }
          });
          return playlistRows.join("\n");
        }
      });
    }
  }
}


async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(compression());
  app.use(express.json({ limit: "50mb" }));

  // Prevent browser caching for all API routes
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
    next();
  });


  // ==================== CRON JOBS ENDPOINTS ====================
  app.get("/api/cron-jobs", (req, res) => {
    try {
      const jobs = db.prepare("SELECT * FROM cron_jobs").all();
      res.json({ success: true, jobs });
    } catch (err: any) {
      res.status(500).json({ error: err.message || err });
    }
  });

  app.put("/api/cron-jobs/:id", (req, res) => {
    try {
      const { id } = req.params;
      const { startTime, intervalMinutes, active } = req.body;
      const nextRun = calculateNextRun(startTime, intervalMinutes, null);
      
      db.prepare("UPDATE cron_jobs SET startTime = ?, intervalMinutes = ?, active = ?, nextRun = ? WHERE id = ?")
        .run(startTime, intervalMinutes, active ? 1 : 0, nextRun, id);
        
      res.json({ success: true, message: "定时任务已更新" });
    } catch (err: any) {
      res.status(500).json({ error: err.message || err });
    }
  });

  app.get("/api/cron-jobs/:id/logs", (req, res) => {
    try {
      const { id } = req.params;
      const logs = db.prepare("SELECT * FROM cron_logs WHERE jobId = ? ORDER BY runAt DESC LIMIT 20").all(id);
      res.json({ success: true, logs });
    } catch (err: any) {
      res.status(500).json({ error: err.message || err });
    }
  });

  app.post("/api/cron-jobs/:id/run", async (req, res) => {
    try {
      const { id } = req.params;
      const job = db.prepare("SELECT * FROM cron_jobs WHERE id = ?").get(id) as any;
      if (!job) return res.status(404).json({ error: "Job not found" });
      
      // Run async, don't wait for completion to send response if it takes too long, but we can wait for simple
      await runCronJob(job);
      res.json({ success: true, message: "手动触发执行成功" });
    } catch (err: any) {
      res.status(500).json({ error: err.message || err });
    }
  });


  // ==================== AUTHENTICATION ENDPOINTS (PUBLIC) ====================
  // Get current authentication protection status
  app.get("/api/auth/status", (req, res) => {
    res.json({ passwordSet: !!adminPassword });
  });

  // Verify management password (login)
  app.post("/api/auth/verify", (req, res) => {
    const { password } = req.body;
    if (!adminPassword || password === adminPassword) {
      res.json({ success: true });
    } else {
      res.status(401).json({ success: false, error: "密码不正确，请重新输入" });
    }
  });

  // Change or set a new password
  app.post("/api/auth/set-password", (req, res) => {
    const { oldPassword, newPassword } = req.body;
    
    // If password is already set, verify old password first
    if (adminPassword && oldPassword !== adminPassword) {
      return res.status(401).json({ success: false, error: "原密码不正确，无法更新密码" });
    }
    
    adminPassword = (newPassword || "").trim();
    saveData();
    res.json({ 
      success: true, 
      message: adminPassword ? "管理保护密码已设置成功！" : "管理保护密码已清空，系统已解除密码校验保护" 
    });
  });

  // ==================== SECURITY ACTION MIDDLEWARE ====================
  app.use((req, res, next) => {
    // 0. Only protect /api/ routes. Static assets and index.html must remain public.
    if (!req.path.startsWith("/api/")) {
      return next();
    }

    // 1. Skip paths that must always be public for TV playback players, external probes or login verification
    const isPublicPath = 
      req.path.startsWith("/api/export/") || 
      req.path === "/api/epg/guide" || 
      req.path === "/api/sources/detect-ip" ||
      req.path === "/api/auth/status" ||
      req.path === "/api/auth/verify" ||
      req.path === "/api/sources/client-test-results" ||
      req.path === "/api/sources/client-test-list" ||
      (req.path === "/api/channels" && req.method === "GET");
      
    if (isPublicPath) {
      return next();
    }

    // 2. If no admin password is set yet, bypass protection entirely
    if (!adminPassword) {
      return next();
    }

    // 3. Otherwise, check validation header
    const clientSecretHeader = req.headers["x-admin-password"];
    if (clientSecretHeader !== adminPassword) {
      return res.status(401).json({ 
        error: "Unauthorized: 您未提供管理密码或密码校验过期", 
        code: "AUTH_REQUIRED" 
      });
    }

    next();
  });

  // API Endpoints
  // Settings Endpoints
  app.get("/api/settings", (req, res) => {
    res.json({ githubProxy, autoCreateChannel, ipGeoApis, autoSwitchGeoApi, m3uLogoVersion, carouselProxyPresets });
  });

  app.post("/api/settings", (req, res) => {
    const { githubProxy: proxy, autoCreateChannel: autoCreate, ipGeoApis: newIpGeoApis, autoSwitchGeoApi: newAutoSwitchGeoApi, m3uLogoVersion: newM3uLogoVersion, carouselProxyPresets: newCarouselProxyPresets } = req.body;
    if (proxy !== undefined) {
      githubProxy = (proxy || "").trim();
    }
    if (autoCreate !== undefined) {
      autoCreateChannel = !!autoCreate;
    }
    if (newIpGeoApis !== undefined) {
      ipGeoApis = newIpGeoApis;
    }
    if (newAutoSwitchGeoApi !== undefined) {
      autoSwitchGeoApi = !!newAutoSwitchGeoApi;
    }
    if (newM3uLogoVersion !== undefined) {
      m3uLogoVersion = (newM3uLogoVersion || "").trim();
    }
    if (newCarouselProxyPresets !== undefined) {
      carouselProxyPresets = newCarouselProxyPresets;
    }

    saveData();
    res.json({ success: true, githubProxy, autoCreateChannel, ipGeoApis, autoSwitchGeoApi, m3uLogoVersion, carouselProxyPresets });
  });

  // EPG Sources REST Endpoints
  app.get("/api/epg-sources", (req, res) => {
    res.json(epgSources);
  });

  app.post("/api/epg-sources", (req, res) => {
    const { name, url, active } = req.body;
    if (!name || !url) {
      return res.status(400).json({ error: "EPG名称和URL不能为空" });
    }
    const newSource: EpgSource = {
      id: "epg_" + Math.random().toString(36).substring(2, 10),
      name: name.trim(),
      url: url.trim(),
      active: active === undefined ? true : !!active,
      status: "never",
    };
    epgSources.push(newSource);
    saveData();
    res.json({ success: true, source: newSource });
  });

  app.put("/api/epg-sources/:id", (req, res) => {
    const { id } = req.params;
    const { name, url, active } = req.body;
    const source = epgSources.find((s) => s.id === id);
    if (!source) {
      return res.status(404).json({ error: "未找到该 EPG 源" });
    }
    if (name !== undefined) source.name = name.trim();
    if (url !== undefined) source.url = url.trim();
    if (active !== undefined) source.active = !!active;
    saveData();
    res.json({ success: true, source });
  });

  app.delete("/api/epg-sources/:id", (req, res) => {
    const { id } = req.params;
    const initialLen = epgSources.length;
    epgSources = epgSources.filter((s) => s.id !== id);
    if (epgSources.length === initialLen) {
      return res.status(404).json({ error: "EPG源不存在" });
    }
    // Delete cache file if exists
    try {
      const cachePath = path.join(EPG_CACHE_DIR, `${id}.json`);
      if (fs.existsSync(cachePath)) {
        fs.unlinkSync(cachePath);
      }
      delete loadedEpgCaches[id];
    } catch (_) {}
    saveData();
    res.json({ success: true });
  });

  app.post("/api/epg-sources/:id/sync", async (req, res) => {
    const { id } = req.params;
    const source = epgSources.find((s) => s.id === id);
    if (!source) {
      return res.status(404).json({ error: "未找到该 EPG 源" });
    }
    const success = await performEpgSync(source);
    res.json({ success, source });
  });

  app.post("/api/epg-sources/sync-all", async (req, res) => {
    let successCount = 0;
    const activeSources = epgSources.filter((s) => s.active);
    for (const source of activeSources) {
      const success = await performEpgSync(source);
      if (success) successCount++;
    }
    res.json({ success: true, count: activeSources.length, successCount });
  });

  // Group CRUD Endpoints
  
  // Isolate (soft-delete) or restore a source
  app.post("/api/channels/:channelId/sources/:sourceId/isolate", (req, res) => {
    const { channelId, sourceId } = req.params;
    const { isolated } = req.body;
    
    const channel = channels.find((c) => c.id === channelId);
    if (!channel) return res.status(404).json({ error: "Channel not found" });
    
    const source = channel.sources.find((s) => s.id === sourceId);
    if (!source) return res.status(404).json({ error: "Source not found" });
    
    source.isolated = !!isolated;
    saveData();
    
    res.json({ success: true, isolated: source.isolated });
  });

  app.get("/api/groups", (req, res) => {
    res.json(groups);
  });

  app.post("/api/groups", (req, res) => {
    const { name, isolated } = req.body;
    if (!name) {
      return res.status(400).json({ error: "分组名称不能为空" });
    }
    const newGroup: Group = {
      id: "g_" + Math.random().toString(36).substring(2, 10),
      name,
      isolated: !!isolated,
    };
    groups.push(newGroup);
    saveData();
    res.status(201).json(newGroup);
  });

  app.put("/api/groups/:id", (req, res) => {
    const { id } = req.params;
    const { name, isolated } = req.body;

    const group = groups.find((g) => g.id === id);
    if (!group) {
      return res.status(404).json({ error: "未找到该分组" });
    }
    if (name) group.name = name;
    if (isolated !== undefined) group.isolated = !!isolated;
    saveData();
    res.json(group);
  });

  app.post("/api/groups/:id/isolated", (req, res) => {
    const { id } = req.params;
    const { isolated } = req.body;
    
    const group = groups.find((g) => g.id === id);
    if (!group) {
      return res.status(404).json({ error: "Group not found" });
    }
    
    group.isolated = !!isolated;
    saveData();
    res.json({ success: true, isolated: group.isolated });
  });

  
  app.post("/api/groups/reorder", (req, res) => {
    const { groupIds } = req.body;
    if (!Array.isArray(groupIds)) {
      return res.status(400).json({ error: "请提供合法的分组 ID 列表" });
    }
    
    const newGroups: typeof groups = [];
    groupIds.forEach(id => {
      const g = groups.find(g => g.id === id);
      if (g) newGroups.push(g);
    });
    
    // Add any missing groups to the end
    groups.forEach(g => {
      if (!newGroups.some(ng => ng.id === g.id)) {
        newGroups.push(g);
      }
    });
    
    groups = newGroups;
    saveData();
    res.json({ success: true });
  });

  app.delete("/api/groups/:id", (req, res) => {
    const { id } = req.params;
    groups = groups.filter((g) => g.id !== id);

    // Remove group reference from all channels
    channels.forEach((c) => {
      c.groupIds = c.groupIds.filter((gId) => gId !== id);
      // Ensure it has at least one group
      if (c.groupIds.length === 0) {
        let otherGroup = groups.find((g) => g.id === "g_other" || g.name === "其它频道");
        if (!otherGroup) {
          otherGroup = { id: "g_other", name: "其它频道" };
          groups.push(otherGroup);
        }
        c.groupIds.push(otherGroup.id);
      }
    });

    saveData();
    res.json({ success: true, message: "分组删除成功" });
  });

    app.get("/api/all-data", (req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.json({
      channels,
      syncConfigs,
      groups,
      epgSources,
      settings: { githubProxy, autoCreateChannel, ipGeoApis, autoSwitchGeoApi, m3uLogoVersion, carouselProxyPresets }
    });
  });

app.get("/api/channels", async (req, res) => {
    const { status, only_active, full, all, isp, province, ip, clientIp } = req.query;

    if (full === "true" || all === "true") {
      if (status === "active" || only_active === "true") {
        const filtered = channels.map((ch) => ({
          ...ch,
          sources: (ch.sources || []).filter((src) => src.status === "active" && !src.isolated)
        })).filter((ch) => ch.sources.length > 0);
        return res.json(filtered);
      } else if (status === "test" || status === "testable" || status === "active,unknown" || status === "active,untested") {
        const filtered = channels.map((ch) => ({
          ...ch,
          sources: (ch.sources || []).filter((src) => !src.isolated && (src.status === "active" || src.status === "unknown" || src.status === "checking"))
        })).filter((ch) => ch.sources.length > 0);
        return res.json(filtered);
      }
      return res.json(channels);
    }

    let targetProvince = province ? String(province) : "";
    let targetIsp = isp ? String(isp) : "";

    if (!province && !isp) {
      let resolvedClientIp = "";
      if (typeof ip === "string" && ip) {
        resolvedClientIp = ip;
      } else if (typeof clientIp === "string" && clientIp) {
        resolvedClientIp = clientIp;
      } else if (typeof req.headers["x-forwarded-for"] === "string") {
        resolvedClientIp = req.headers["x-forwarded-for"].split(",")[0].trim();
      } else if (Array.isArray(req.headers["x-forwarded-for"])) {
        resolvedClientIp = req.headers["x-forwarded-for"][0].trim();
      } else if (typeof req.headers["x-real-ip"] === "string") {
        resolvedClientIp = req.headers["x-real-ip"].trim();
      } else {
        resolvedClientIp = req.socket.remoteAddress || "";
      }

      if (resolvedClientIp) {
        try {
          const geo = await getClientIpGeo(resolvedClientIp);
          targetProvince = geo.province;
          targetIsp = geo.isp;
          console.log(`[CHANNELS AUTO-IP] Client IP ${resolvedClientIp} matched Province: ${targetProvince}, ISP: ${targetIsp}`);
        } catch (e) {
          console.error("[CHANNELS AUTO-IP ERROR]", e);
        }
      }
    }

    const results = channels.map((ch) => {
      let list = ch.sources || [];

      if (status === "active" || only_active === "true") {
        list = list.filter((src) => src.status === "active");
      } else if (status === "test" || status === "testable" || status === "active,unknown" || status === "active,untested") {
        list = list.filter((src) => src.status === "active" || src.status === "unknown" || src.status === "checking");
      }

      list = getPlayableSources(list, targetIsp, targetProvince);

      return {
        ...ch,
        sources: list
      };
    }).filter((ch) => ch.sources.length > 0);

    res.json(results);
  });

  app.post("/api/channels", (req, res) => {
    const { name, groupIds, category, logo, alias, epgId } = req.body;
    if (!name) {
      return res.status(400).json({ error: "频道名称为必填项" });
    }

    let resolvedGroupIds: string[] = [];
    if (groupIds && Array.isArray(groupIds) && groupIds.length > 0) {
      resolvedGroupIds = groupIds;
    } else if (category) {
      let g = groups.find((g) => g.name === category);
      if (!g) {
        g = { id: "g_" + Math.random().toString(36).substring(2, 10), name: category };
        groups.push(g);
      }
      resolvedGroupIds = [g.id];
    }

    if (resolvedGroupIds.length === 0) {
      let otherGroup = groups.find((g) => g.id === "g_other" || g.name === "其它频道");
      if (!otherGroup) {
        otherGroup = { id: "g_other", name: "其它频道" };
        groups.push(otherGroup);
      }
      resolvedGroupIds = [otherGroup.id];
    }

    const newChannel: Channel = {
      id: "ch_" + Math.random().toString(36).substring(2, 10),
      name,
      groupIds: resolvedGroupIds,
      logo: logo || "https://images.unsplash.com/photo-1598257006458-087169a1f08d?auto=format&fit=crop&w=48&h=48&q=80",
      alias: alias ? (Array.isArray(alias) ? alias : alias.split(",").map((s: string) => s.trim())) : [name],
      epgId: epgId || generateDefaultEpgId(name),
      isolated: !!req.body.isolated,
      sources: []
    };

    channels.push(newChannel);
    saveData();
    res.status(201).json(newChannel);
  });

  app.put("/api/channels/:id", (req, res) => {
    const { id } = req.params;
    const { name, groupIds, category, logo, alias, epgId, isolated } = req.body;

    const channel = channels.find((c) => c.id === id);
    if (!channel) {
      return res.status(404).json({ error: "未找到该频道" });
    }

    if (name) channel.name = name;
    
    if (groupIds && Array.isArray(groupIds)) {
      channel.groupIds = groupIds;
    } else if (category) {
      let g = groups.find((g) => g.name === category);
      if (!g) {
        g = { id: "g_" + Math.random().toString(36).substring(2, 10), name: category };
        groups.push(g);
      }
      channel.groupIds = [g.id];
    }

    if (logo !== undefined) channel.logo = logo;
    if (alias !== undefined) {
      channel.alias = Array.from(new Set(Array.isArray(alias) ? alias : alias.split(/[,;，；:]/).map((s: string) => s.trim()).filter(Boolean)));
    }
    if (epgId !== undefined) channel.epgId = epgId;
    if (isolated !== undefined) {
      channel.isolated = !!isolated;
      if (channel.sources) {
        channel.sources.forEach(s => s.isolated = !!isolated);
      }
    }

    saveData();
    res.json(channel);
  });

  // Toggle single channel isolation
  app.post("/api/channels/:id/isolated", (req, res) => {
    const { id } = req.params;
    const { isolated } = req.body;
    const channel = channels.find((c) => c.id === id);
    if (!channel) {
      return res.status(404).json({ error: "未找到该频道" });
    }
    channel.isolated = !!isolated;
    if (channel.sources) {
      channel.sources.forEach(s => s.isolated = !!isolated);
    }
    saveData();
    res.json({ success: true, isolated: channel.isolated });
  });

  // Batch toggle channel isolation
  app.post("/api/channels/batch-isolate", (req, res) => {
    const { channelIds, isolated } = req.body;
    if (!Array.isArray(channelIds) || channelIds.length === 0) {
      return res.status(400).json({ error: "请提供频道 ID 列表" });
    }
    let updatedCount = 0;
    channels.forEach((c) => {
      if (channelIds.includes(c.id)) {
        c.isolated = !!isolated;
        if (c.sources) {
          c.sources.forEach(s => s.isolated = !!isolated);
        }
        updatedCount++;
      }
    });
    saveData();
    res.json({ success: true, count: updatedCount, isolated: !!isolated });
  });

  
  app.post("/api/channels/reorder", (req, res) => {
    const { channelIds } = req.body;
    if (!Array.isArray(channelIds)) {
      return res.status(400).json({ error: "请提供合法的频道 ID 列表" });
    }
    
    const newChannels: typeof channels = [];
    channelIds.forEach(id => {
      const c = channels.find(c => c.id === id);
      if (c) newChannels.push(c);
    });
    
    // Add any missing channels to the end
    channels.forEach(c => {
      if (!newChannels.some(nc => nc.id === c.id)) {
        newChannels.push(c);
      }
    });
    
    channels = newChannels;
    saveData();
    res.json({ success: true });
  });

  app.delete("/api/channels/:id", (req, res) => {
    const { id } = req.params;
    const initialLength = channels.length;
    channels = channels.filter((c) => c.id !== id);

    if (channels.length === initialLength) {
      return res.status(404).json({ error: "未找到该频道" });
    }

    saveData();
    res.json({ success: true, message: "频道删除成功" });
  });

  // Batch delete channels
  app.post("/api/channels/batch-delete", (req, res) => {
    const { channelIds } = req.body;
    if (!Array.isArray(channelIds) || channelIds.length === 0) {
      return res.status(400).json({ error: "请提供要删除的频道 ID 列表" });
    }

    const initialLength = channels.length;
    channels = channels.filter((c) => !channelIds.includes(c.id));

    saveData();
    res.json({ success: true, count: initialLength - channels.length });
  });

  // Merge multiple channels
  app.post("/api/channels/merge", (req, res) => {
    const { channelIds, primaryId } = req.body;
    if (!Array.isArray(channelIds) || channelIds.length < 2) {
      return res.status(400).json({ error: "请提供至少两个要合并的频道 ID" });
    }

    const targetChannels = channels.filter(c => channelIds.includes(c.id));
    if (targetChannels.length < 2) {
      return res.status(400).json({ error: "未找到足够的待合并频道项目" });
    }

    // Score channels to pick the most complete/valid as primary
    const getScore = (ch: typeof targetChannels[0]) => {
      let score = 0;
      if (ch.name && ch.name.trim().length > 0) score += 2;
      if (ch.logo && (ch.logo.startsWith("http") || ch.logo.startsWith("/") || ch.logo.length > 5)) score += 5;
      if (ch.epgId && ch.epgId.trim().length > 0 && !/^\d+$/.test(ch.epgId)) score += 3;
      if (ch.groupIds && ch.groupIds.length > 0) score += ch.groupIds.length;
      if (ch.sources && ch.sources.length > 0) score += ch.sources.length * 2;
      if (ch.alias && ch.alias.length > 0) score += ch.alias.length;

      // Heavy priority score boost for names that match the system's standard preset channel list (DEFAULT_CHANNELS and templates)
      const hasPresetName = DEFAULT_CHANNELS.some(
        dc => dc.name.trim().toLowerCase() === ch.name.trim().toLowerCase() || dc.id === ch.id
      );
      if (hasPresetName) {
        score += 10000;
      } else {
        const isTemplateName = loadedDefaultAliases.some(
          group => group.template.trim().toLowerCase() === ch.name.trim().toLowerCase()
        );
        if (isTemplateName) {
          score += 5000;
        } else {
          const aliasTemplate = findAliasTemplate(ch.name);
          if (aliasTemplate && aliasTemplate.templateName.trim().toLowerCase() === ch.name.trim().toLowerCase()) {
            score += 1000;
          }
        }
      }
      return score;
    };

    const sortedByCompleteness = [...targetChannels].sort((a, b) => getScore(b) - getScore(a));
    
    // Pick primary channel: either specified by user, or fallback to auto (best completeness score)
    let primaryChannel = sortedByCompleteness[0];
    if (primaryId) {
      const explicitPrimary = targetChannels.find(c => c.id === primaryId);
      if (explicitPrimary) {
        primaryChannel = explicitPrimary;
      }
    }

    // If one of the target channels being merged can be matched to a canonical channel list template name,
    // we use that standard name as the main channel name
    let resolvedStandardName = "";
    for (const ch of targetChannels) {
      const match = DEFAULT_CHANNELS.find(
        dc => dc.name.trim().toLowerCase() === ch.name.trim().toLowerCase() || dc.id === ch.id
      );
      if (match) {
        resolvedStandardName = match.name;
        break;
      }
    }

    if (!resolvedStandardName) {
      for (const ch of targetChannels) {
        const match = loadedDefaultAliases.find(
          group => group.template.trim().toLowerCase() === ch.name.trim().toLowerCase()
        );
        if (match) {
          resolvedStandardName = match.template;
          break;
        }
      }
    }

    if (!resolvedStandardName) {
      for (const ch of targetChannels) {
        const match = findAliasTemplate(ch.name);
        if (match) {
          resolvedStandardName = match.templateName;
          break;
        }
      }
    }

    if (resolvedStandardName) {
      console.log(`[Channel Merge] Prioritized preset/standard channel list name: "${primaryChannel.name}" -> "${resolvedStandardName}"`);
      primaryChannel.name = resolvedStandardName;
    }

    const allNames = new Set<string>();
    const allAliases = new Set<string>();
    const allGroupIds = new Set<string>();
    const logoCandidates: string[] = [];
    const epgIdCandidates: string[] = [];

    targetChannels.forEach(c => {
      if (c.name) allNames.add(c.name.trim());
      // 添加其他频道的名称作为别名
      if (c.id !== primaryChannel.id && c.name) {
        allAliases.add(c.name.trim());
      }
      if (c.alias && Array.isArray(c.alias)) {
        c.alias.forEach(a => {
          if (a) allAliases.add(a.trim());
        });
      }
      if (c.groupIds && Array.isArray(c.groupIds)) {
        c.groupIds.forEach(g => allGroupIds.add(g));
      }
      if (c.logo && c.logo.trim()) {
        logoCandidates.push(c.logo.trim());
      }
      if (c.epgId && c.epgId.trim()) {
        epgIdCandidates.push(c.epgId.trim());
      }
    });

    let bestLogo = primaryChannel.logo || "";
    const isSystemGenerated = (logo: string) => !logo || logo.includes("unsplash.com");
    
    // 只有主频道logo为空或系统生成的，才选取其他频道的logo
    if (isSystemGenerated(bestLogo)) {
      const alternativeLogo = logoCandidates.find(l => !isSystemGenerated(l));
      if (alternativeLogo) {
        bestLogo = alternativeLogo;
      }
    }

    let bestEpgId = primaryChannel.epgId || "";
    const validEpgId = epgIdCandidates.find(e => e && !/^\d+$/.test(e) && e.toLowerCase() !== "null" && e.toLowerCase() !== "undefined");
    if (validEpgId) {
      bestEpgId = validEpgId;
    } else if (epgIdCandidates.length > 0) {
      bestEpgId = epgIdCandidates[0];
    }

    const mergedSources: typeof primaryChannel.sources = [];
    const addedUrls = new Set<string>();

    const allSources = [
      ...(primaryChannel.sources || []),
      ...targetChannels.filter(c => c.id !== primaryChannel.id).flatMap(c => c.sources || [])
    ];

    allSources.forEach(s => {
      if (!s || !s.url) return;
      const cleanUrl = s.url.trim();
      if (!addedUrls.has(cleanUrl)) {
        addedUrls.add(cleanUrl);
        mergedSources.push({
          ...s,
          url: cleanUrl
        });
      } else {
        const existingIdx = mergedSources.findIndex(x => x.url === cleanUrl);
        if (existingIdx !== -1) {
          const existing = mergedSources[existingIdx];
          if (existing.status !== "active" && s.status === "active") {
            mergedSources[existingIdx] = s;
          } else if (existing.status === s.status && s.latency && (!existing.latency || s.latency < existing.latency)) {
            mergedSources[existingIdx] = s;
          }
        }
      }
    });

    const primaryName = primaryChannel.name;
    allNames.forEach(n => {
      if (n !== primaryName) {
        allAliases.add(n);
      }
    });

    primaryChannel.logo = bestLogo;
    primaryChannel.epgId = bestEpgId;
    primaryChannel.groupIds = Array.from(allGroupIds);
    primaryChannel.alias = Array.from(allAliases).filter(a => a !== primaryName);
    primaryChannel.sources = mergedSources;

    const otherIdsToMerge = channelIds.filter(id => id !== primaryChannel.id);
    channels = channels.filter(c => !otherIdsToMerge.includes(c.id));

    saveData();

    res.json({
      success: true,
      message: `成功合并 ${targetChannels.length} 个频道。保留了最完备的主频道 [${primaryChannel.name}]，合并后包含别名: ${primaryChannel.alias.join(", ") || "无"}，已整合并去重 ${primaryChannel.sources.length} 条播放线路。`,
      primaryChannel
    });
  });

  // Batch update channel groups
  app.post("/api/channels/batch-groups", (req, res) => {
    const { channelIds, groupIds, mode } = req.body;
    if (!Array.isArray(channelIds) || channelIds.length === 0) {
      return res.status(400).json({ error: "请提供目标频道 ID 列表" });
    }
    if (!Array.isArray(groupIds)) {
      return res.status(400).json({ error: "请提供合法的分组 ID 列表" });
    }

    let updatedCount = 0;
    channels.forEach((c) => {
      if (channelIds.includes(c.id)) {
        if (!Array.isArray(c.groupIds)) {
          c.groupIds = [];
        }
        if (mode === "append") {
          // Append selected groupIds to existing groupIds, preserving other categories
          const merged = new Set([...c.groupIds, ...groupIds]);
          c.groupIds = Array.from(merged);
        } else {
          // Replace mode (default): overwrite existing categories with selected ones
          c.groupIds = groupIds;
        }
        updatedCount++;
      }
    });

    if (updatedCount > 0) {
      saveData();
    }
    res.json({ success: true, count: updatedCount });
  });

  // --- Smart Organize Helper Functions ---
  const PROVINCES_LIST = [
    "北京", "上海", "天津", "重庆", "河北", "山西", "辽宁", "吉林", "黑龙江", "江苏",
    "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "海南",
    "四川", "贵州", "云南", "陕西", "甘肃", "青海", "台湾", "内蒙古", "广西", "西藏",
    "宁夏", "新疆", "香港", "澳门"
  ];

  const CITY_TO_PROVINCE: Record<string, string> = {
    // 广东
    "广州": "广东", "深圳": "广东", "珠海": "广东", "汕头": "广东", "佛山": "广东", "韶关": "广东", "湛江": "广东", "肇庆": "广东", "江门": "广东", "茂名": "广东", "惠州": "广东", "梅州": "广东", "汕尾": "广东", "河源": "广东", "阳江": "广东", "清远": "广东", "东莞": "广东", "中山": "广东", "潮州": "广东", "揭阳": "广东", "云浮": "广东", "珠江": "广东", "南方": "广东",
    // 浙江
    "杭州": "浙江", "宁波": "浙江", "温州": "浙江", "嘉兴": "浙江", "湖州": "浙江", "绍兴": "浙江", "金华": "浙江", "衢州": "浙江", "舟山": "浙江", "台州": "浙江", "丽水": "浙江",
    // 江苏
    "南京": "江苏", "无锡": "江苏", "徐州": "江苏", "常州": "江苏", "苏州": "江苏", "南通": "江苏", "连云港": "江苏", "淮安": "江苏", "盐城": "江苏", "扬州": "江苏", "镇江": "江苏", "泰州": "江苏", "宿迁": "江苏",
    // 湖南
    "长沙": "湖南", "株洲": "湖南", "湘潭": "湖南", "衡阳": "湖南", "邵阳": "湖南", "岳阳": "湖南", "常德": "湖南", "张家界": "湖南", "益阳": "湖南", "郴州": "湖南", "永州": "湖南", "怀化": "湖南", "娄底": "湖南", "湘西": "湖南",
    // 湖北
    "武汉": "湖北", "黄石": "湖北", "十堰": "湖北", "宜昌": "湖北", "襄阳": "湖北", "鄂州": "湖北", "荆门": "湖北", "孝感": "湖北", "荆州": "湖北", "黄冈": "湖北", "咸宁": "湖北", "随州": "湖北", "恩施": "湖北",
    // 四川
    "成都": "四川", "自贡": "四川", "攀枝花": "四川", "泸州": "四川", "德阳": "四川", "绵阳": "四川", "广元": "四川", "遂宁": "四川", "内江": "四川", "乐山": "四川", "南充": "四川", "眉山": "四川", "宜宾": "四川", "广安": "四川", "达州": "四川", "雅安": "四川", "巴中": "四川", "资阳": "四川", "凉山": "四川",
    // 山东
    "济南": "山东", "青岛": "山东", "淄博": "山东", "枣庄": "山东", "东营": "山东", "烟台": "山东", "潍坊": "山东", "济宁": "山东", "泰安": "山东", "威海": "山东", "日照": "山东", "临沂": "山东", "德州": "山东", "聊城": "山东", "滨州": "山东", "菏泽": "山东",
    // 河南
    "郑州": "河南", "开封": "河南", "洛阳": "河南", "平顶山": "河南", "安阳": "河南", "鹤壁": "河南", "新乡": "河南", "焦作": "河南", "濮阳": "河南", "许昌": "河南", "漯河": "河南", "三门峡": "河南", "南阳": "河南", "商丘": "河南", "信阳": "河南", "周口": "河南", "驻马店": "河南",
    // 河北
    "石家庄": "河北", "唐山": "河北", "秦皇岛": "河北", "邯郸": "河北", "邢台": "河北", "保定": "河北", "张家口": "河北", "承德": "河北", "沧州": "河北", "廊坊": "河北", "衡水": "河北",
    // 山西
    "太原": "山西", "大同": "山西", "阳泉": "山西", "长治": "山西", "晋城": "山西", "朔州": "山西", "晋中": "山西", "运城": "山西", "忻州": "山西", "临汾": "山西", "吕梁": "山西",
    // 辽宁
    "沈阳": "辽宁", "大连": "辽宁", "鞍山": "辽宁", "抚顺": "辽宁", "本溪": "辽宁", "丹东": "辽宁", "锦州": "辽宁", "营口": "辽宁", "阜新": "辽宁", "辽阳": "辽宁", "盘锦": "辽宁", "铁岭": "辽宁", "朝阳": "辽宁", "葫芦岛": "辽宁",
    // 吉林
    "长春": "吉林", "吉林市": "吉林", "四平": "吉林", "辽源": "吉林", "通化": "吉林", "白山": "吉林", "松原": "吉林", "白城": "吉林", "延边": "吉林",
    // 黑龙江
    "哈尔滨": "黑龙江", "齐齐哈尔": "黑龙江", "鸡西": "黑龙江", "鹤岗": "黑龙江", "双鸭山": "黑龙江", "大庆": "黑龙江", "伊春": "黑龙江", "佳木斯": "黑龙江", "七台河": "黑龙江", "牡丹江": "黑龙江", "黑河": "黑龙江", "绥化": "黑龙江",
    // 安徽
    "合肥": "安徽", "芜湖": "安徽", "蚌埠": "安徽", "淮南": "安徽", "马鞍山": "安徽", "淮北": "安徽", "铜陵": "安徽", "安庆": "安徽", "黄山": "安徽", "滁州": "安徽", "阜阳": "安徽", "宿州": "安徽", "六安": "安徽", "亳州": "安徽", "池州": "安徽", "宣城": "安徽",
    // 福建
    "福州": "福建", "厦门": "福建", "莆田": "福建", "三明": "福建", "泉州": "福建", "漳州": "福建", "南平": "福建", "龙岩": "福建", "宁德": "福建",
    // 江西
    "南昌": "江西", "景德镇": "江西", "萍乡": "江西", "九江": "江西", "新余": "江西", "鹰潭": "江西", "赣州": "江西", "吉安": "江西", "宜春": "江西", "抚州": "江西", "上饶": "江西",
    // 陕西
    "西安": "陕西", "铜川": "陕西", "宝鸡": "陕西", "咸阳": "陕西", "渭南": "陕西", "延安": "陕西", "汉中": "陕西", "榆林": "陕西", "安康": "陕西", "商洛": "陕西",
    // 甘肃
    "兰州": "甘肃", "嘉峪关": "甘肃", "金昌": "甘肃", "白银": "甘肃", "天水": "甘肃", "武威": "甘肃", "张掖": "甘肃", "平凉": "甘肃", "酒泉": "甘肃", "庆阳": "甘肃", "定西": "甘肃", "陇南": "甘肃",
    // 贵州
    "贵阳": "贵州", "六盘水": "贵州", "遵义": "贵州", "安顺": "贵州", "毕节": "贵州", "铜仁": "贵州",
    // 云南
    "昆明": "云南", "曲靖": "云南", "玉溪": "云南", "保山": "云南", "昭通": "云南", "丽江": "云南", "普洱": "云南", "临沧": "云南",
    // 海南
    "海口": "海南", "三亚": "海南",
    // 广西
    "南宁": "广西", "柳州": "广西", "桂林": "广西", "梧州": "广西", "北海": "广西", "防城港": "广西", "钦州": "广西", "贵港": "广西", "玉林": "广西", "百色": "广西", "贺州": "广西", "河池": "广西", "来宾": "广西", "崇左": "广西",
    // 内蒙古
    "呼和浩特": "内蒙古", "包头": "内蒙古", "乌海": "内蒙古", "赤峰": "内蒙古", "通辽": "内蒙古", "鄂尔多斯": "内蒙古", "呼伦贝尔": "内蒙古",
    // 新疆
    "乌鲁木齐": "新疆", "克拉玛依": "新疆",
    // 宁夏
    "银川": "宁夏", "石嘴山": "宁夏", "吴忠": "宁夏", "固原": "宁夏", "中卫": "宁夏",
    // 青海
    "西宁": "青海", "海东": "青海",
    // 西藏
    "拉萨": "西藏", "日喀则": "西藏",
    // 港澳台
    "香港": "香港", "TVB": "香港", "翡翠": "香港", "明珠": "香港", "J2": "香港", "澳门": "澳门", "澳视": "澳门", "台湾": "台湾", "中视": "台湾", "华视": "台湾", "台视": "台湾", "三立": "台湾", "东森": "台湾"
  };

  const STANDARD_CCTV_NAME_MAP: Record<string, string> = {
    "cctv1": "CCTV-1 综合",
    "cctv2": "CCTV-2 财经",
    "cctv3": "CCTV-3 综艺",
    "cctv4": "CCTV-4 中文国际",
    "cctv4asia": "CCTV-4 亚洲",
    "cctv4europe": "CCTV-4 欧洲",
    "cctv4america": "CCTV-4 美洲",
    "cctv5": "CCTV-5 体育",
    "cctv5+": "CCTV-5+ 体育赛事",
    "cctv5plus": "CCTV-5+ 体育赛事",
    "cctv6": "CCTV-6 电影",
    "cctv7": "CCTV-7 国防军事",
    "cctv8": "CCTV-8 电视剧",
    "cctv9": "CCTV-9 纪录",
    "cctv10": "CCTV-10 科教",
    "cctv11": "CCTV-11 戏曲",
    "cctv12": "CCTV-12 社会与法",
    "cctv13": "CCTV-13 新闻",
    "cctv14": "CCTV-14 少儿",
    "cctv15": "CCTV-15 音乐",
    "cctv16": "CCTV-16 奥林匹克",
    "cctv17": "CCTV-17 农业农村",
    "cctv4k": "CCTV-4K 超高清",
    "cctv8k": "CCTV-8K 超高清"
  };

  function detectProvinceAndIspFromName(text: string) {
    let detectedProvince = "";
    let detectedIsp = "";

    if (!text) return { detectedProvince, detectedIsp };

    if (/电信/i.test(text)) detectedIsp = "电信";
    else if (/联通/i.test(text)) detectedIsp = "联通";
    else if (/移动/i.test(text)) detectedIsp = "移动";
    else if (/广电/i.test(text)) detectedIsp = "广电";

    for (const p of PROVINCES_LIST) {
      if (text.includes(p)) {
        detectedProvince = p;
        break;
      }
    }

    if (!detectedProvince) {
      for (const [city, prov] of Object.entries(CITY_TO_PROVINCE)) {
        if (text.includes(city)) {
          detectedProvince = prov;
          break;
        }
      }
    }

    return { detectedProvince, detectedIsp };
  }

  function cleanChannelNameForSmartOrganize(originalName: string, options: any) {
    if (!originalName) return "";
    let name = originalName.trim();

    if (options.stripResolution !== false) {
      name = stripBitrateAndResolution(name);
    }

    if (options.extractIspAndProvince !== false) {
      name = name.replace(/(?:\s+|-|_)*(?:移动|电信|联通|广电|BGP|内网|组播)+(?:\s+|-|_)*/gi, " ");
    }

    if (options.normalizeCctv !== false && /^cctv/i.test(name.trim())) {
      const normKey = normalizeChannelName(name);
      if (STANDARD_CCTV_NAME_MAP[normKey]) {
        return STANDARD_CCTV_NAME_MAP[normKey];
      }
    }

    if (options.normalizeSatTv !== false && name.includes("卫视")) {
      const matchSat = name.match(/([\u4e00-\u9fa5]{2,6}卫视)/);
      if (matchSat) {
        return matchSat[1];
      }
    }

    name = name.replace(/^[\s\-_:,，;；]+|[\s\-_:,，;；]+$/g, "").trim();
    return name || originalName;
  }

  function determineSmartTargetGroup(channelName: string, detectedProvince: string, options: any) {
    const mode = options.groupingMode || "smart";
    const upper = channelName.toUpperCase();

    if (/^CCTV/i.test(upper) || upper.includes("央视") || upper.includes("CGTN") || upper.includes("CETV")) {
      return "央视频道";
    }

    if (upper.includes("4K") || upper.includes("8K") || upper.includes("超高清")) {
      return "4K超清";
    }

    if (channelName.includes("卫视")) {
      if (mode === "province_only" && detectedProvince) {
        return detectedProvince;
      }
      return "卫视频道";
    }

    if (/翡翠|明珠|TVB|凤凰|澳视|华视|台视|中视|三立|东森|HBO|星空/i.test(channelName) ||
        detectedProvince === "香港" || detectedProvince === "澳门" || detectedProvince === "台湾") {
      return "港澳台";
    }

    if (/体育|五星|风云足球|高尔夫|极速汽车/i.test(channelName)) {
      return "体育频道";
    }

    if (/影院|电影|剧场|动作|喜剧|动画|卡酷|少儿|纪录片|纪实|iHOT|CHC/i.test(channelName)) {
      return "影视频道";
    }

    if (detectedProvince) {
      if (mode === "province_only") {
        return detectedProvince;
      }
      return `${detectedProvince}地方`;
    }

    return "其它频道";
  }

  // --- Smart Organize (智能整理) Endpoints ---
  app.post("/api/channels/smart-organize/preview", (req, res) => {
    try {
      const options = req.body || {};
      const groupingMode = options.groupingMode || "smart"; // "smart" | "province_only" | "keep_existing"
      const normalizeCctv = options.normalizeCctv !== false;
      const normalizeSatTv = options.normalizeSatTv !== false;
      const stripResolution = options.stripResolution !== false;
      const extractIspAndProvince = options.extractIspAndProvince !== false;

      // Group name mapping
      const groupMap = new Map<string, string>(); // id -> name
      groups.forEach((g) => groupMap.set(g.id, g.name));

      const changes: any[] = [];
      const neededGroupNames = new Set<string>();

      channels.forEach((c) => {
        const originalName = c.name;
        const rawGroupNames = (c.groupIds || []).map((id) => groupMap.get(id) || "其它频道");
        const originalGroupNames = rawGroupNames.length > 0 ? rawGroupNames : ["其它频道"];

        // 1. Detect Province & ISP from original channel title and sources
        const fullSearchText = originalName + " " + (c.sources || []).map((s) => s.url || "").join(" ");
        const { detectedProvince, detectedIsp } = detectProvinceAndIspFromName(fullSearchText);

        // 2. Clean/Normalize Name
        let newName = cleanChannelNameForSmartOrganize(originalName, {
          stripResolution,
          extractIspAndProvince,
          normalizeCctv,
          normalizeSatTv
        });

        // 3. Determine Target Group
        let targetGroupName = determineSmartTargetGroup(originalName, detectedProvince, { groupingMode });
        
        let targetGroupNames: string[] = [targetGroupName];

        if (groupingMode === "keep_existing") {
          const hasCustomGroup = originalGroupNames.some((gn) => gn !== "其它频道" && gn !== "未分类");
          if (hasCustomGroup) {
            targetGroupNames = [...originalGroupNames];
          }
        }

        // Check source updates
        let sourcesUpdatedCount = 0;
        const proposedSources = (c.sources || []).map((s) => {
          let updatedIsp = s.isp;
          let updatedProvince = s.province;

          if (extractIspAndProvince) {
            if ((!updatedIsp || updatedIsp === "BGP" || updatedIsp === "未知") && detectedIsp) {
              updatedIsp = detectedIsp;
            }
            if ((!updatedProvince || updatedProvince === "全国" || updatedProvince === "未知") && detectedProvince) {
              updatedProvince = detectedProvince;
            }
          }

          if (updatedIsp !== s.isp || updatedProvince !== s.province) {
            sourcesUpdatedCount++;
          }

          return {
            id: s.id,
            url: s.url,
            originalIsp: s.isp || "BGP",
            newIsp: updatedIsp || "BGP",
            originalProvince: s.province || "全国",
            newProvince: updatedProvince || "全国"
          };
        });

        // Record needed group names
        targetGroupNames.forEach((gn) => neededGroupNames.add(gn));

        const nameChanged = originalName !== newName;
        const groupsChanged = JSON.stringify([...originalGroupNames].sort()) !== JSON.stringify([...targetGroupNames].sort());

        if (nameChanged || groupsChanged || sourcesUpdatedCount > 0) {
          changes.push({
            channelId: c.id,
            originalName,
            newName,
            originalGroupNames,
            targetGroupNames,
            sourcesUpdatedCount,
            detectedProvince: detectedProvince || "全国",
            detectedIsp: detectedIsp || "BGP",
            proposedSources,
            nameChanged,
            groupsChanged
          });
        }
      });

      // Find which target groups do not exist yet in database
      const existingGroupNames = new Set(groups.map((g) => g.name));
      const newGroupsToCreate = Array.from(neededGroupNames).filter((gn) => !existingGroupNames.has(gn));

      res.json({
        success: true,
        summary: {
          totalChannels: channels.length,
          modifiedChannelsCount: changes.length,
          nameChangesCount: changes.filter((c) => c.nameChanged).length,
          groupChangesCount: changes.filter((c) => c.groupsChanged).length,
          sourcesUpdatedCount: changes.reduce((sum, c) => sum + c.sourcesUpdatedCount, 0),
          newGroupsToCreate
        },
        changes
      });
    } catch (err: any) {
      console.error("[SmartOrganize Preview Error]", err);
      res.status(500).json({ error: "生成智能整理预览失败: " + err.message });
    }
  });

  app.post("/api/channels/smart-organize/apply", (req, res) => {
    try {
      const { selectedChanges, options = {} } = req.body;
      if (!Array.isArray(selectedChanges) || selectedChanges.length === 0) {
        return res.status(400).json({ error: "请选择要应用的智能整理项目" });
      }

      // 1. Create missing groups
      const existingGroupMap = new Map<string, string>(); // groupName -> groupId
      groups.forEach((g) => existingGroupMap.set(g.name, g.id));

      let createdGroupsCount = 0;
      selectedChanges.forEach((change) => {
        (change.targetGroupNames || []).forEach((gName: string) => {
          if (!existingGroupMap.has(gName)) {
            const newGroupId = "g_" + crypto.randomUUID().slice(0, 8);
            const newGroup = { id: newGroupId, name: gName, sortOrder: groups.length };
            groups.push(newGroup);
            existingGroupMap.set(gName, newGroupId);
            createdGroupsCount++;
            try {
              db.prepare("INSERT OR IGNORE INTO groups (id, name, sortOrder) VALUES (?, ?, ?)").run(
                newGroupId,
                gName,
                newGroup.sortOrder
              );
            } catch (e) {}
          }
        });
      });

      // 2. Apply changes to channels
      let appliedCount = 0;
      const changeMap = new Map<string, any>();
      selectedChanges.forEach((c) => changeMap.set(c.channelId, c));

      channels.forEach((c) => {
        const change = changeMap.get(c.id);
        if (change) {
          if (change.newName) {
            c.name = change.newName;
          }
          if (Array.isArray(change.targetGroupNames)) {
            const targetIds = change.targetGroupNames
              .map((gn: string) => existingGroupMap.get(gn))
              .filter(Boolean);
            if (targetIds.length > 0) {
              c.groupIds = targetIds;
            }
          }
          if (Array.isArray(change.proposedSources) && Array.isArray(c.sources)) {
            const srcMap = new Map<string, any>();
            change.proposedSources.forEach((ps: any) => srcMap.set(ps.id, ps));
            c.sources.forEach((s) => {
              const ps = srcMap.get(s.id);
              if (ps) {
                s.isp = ps.newIsp;
                s.province = ps.newProvince;
              }
            });
          }
          appliedCount++;
        }
      });

      if (appliedCount > 0 || createdGroupsCount > 0) {
        saveData();
      }

      res.json({
        success: true,
        message: `智能整理成功！已整理 ${appliedCount} 个频道，新建 ${createdGroupsCount} 个分组。`,
        appliedCount,
        createdGroupsCount
      });
    } catch (err: any) {
      console.error("[SmartOrganize Apply Error]", err);
      res.status(500).json({ error: "应用智能整理失败: " + err.message });
    }
  });

  // Source endpoints
  app.post("/api/channels/:channelId/sources", (req, res) => {
    const { channelId } = req.params;
    const { url, province, isp, resolution } = req.body;

    if (!url) {
      return res.status(400).json({ error: "播放链接为必填项" });
    }

    const channel = channels.find((c) => c.id === channelId);
    if (!channel) {
      return res.status(404).json({ error: "未找到频道" });
    }

    const newSource: LiveSource = {
      id: "src_" + Math.random().toString(36).substring(2, 10),
      url,
      province: province || "全国",
      isp: isp || "BGP",
      status: "unknown",
      resolution: resolution || undefined,
    };

    channel.sources.push(newSource);
    detectAndRegisterCarouselProxy(url);
    saveData();
    res.status(201).json(newSource);
  });

  app.put("/api/channels/:channelId/sources/:sourceId", (req, res) => {
    const { channelId, sourceId } = req.params;
    const { url, province, isp, status, resolution } = req.body;

    const channel = channels.find((c) => c.id === channelId);
    if (!channel) {
      return res.status(404).json({ error: "未找到频道" });
    }

    const source = channel.sources.find((s) => s.id === sourceId);
    if (!source) {
      return res.status(404).json({ error: "未找到直播源" });
    }

    if (url) {
      source.url = url;
      detectAndRegisterCarouselProxy(url);
    }
    if (province) source.province = province;
    if (isp) source.isp = isp;
    if (status) source.status = status;
    if (resolution !== undefined) source.resolution = resolution;

    saveData();
    res.json(source);
  });

  app.delete("/api/channels/:channelId/sources/:sourceId", (req, res) => {
    const { channelId, sourceId } = req.params;
    const channel = channels.find((c) => c.id === channelId);
    if (!channel) {
      return res.status(404).json({ error: "未找到频道" });
    }

    const initialLength = channel.sources.length;
    channel.sources = channel.sources.filter((s) => s.id !== sourceId);

    if (channel.sources.length === initialLength) {
      return res.status(404).json({ error: "未找到直播源" });
    }

    saveData();
    res.json({ success: true, message: "直播源删除成功" });
  });

  // Batch isolate live sources of a channel
  app.post("/api/channels/:channelId/sources/batch-isolate", (req, res) => {
    const { channelId } = req.params;
    const { sourceIds, isolated } = req.body;
    if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
      return res.status(400).json({ error: "请提供要操作的直播线路 ID 列表" });
    }

    const channel = channels.find((c) => c.id === channelId);
    if (!channel) {
      return res.status(404).json({ error: "未找到频道" });
    }

    let updatedCount = 0;
    channel.sources.forEach((s) => {
      if (sourceIds.includes(s.id)) {
        s.isolated = !!isolated;
        updatedCount++;
      }
    });

    if (updatedCount > 0) {
      saveData();
    }
    res.json({ success: true, count: updatedCount });
  });

  // Batch delete live sources of a channel
  app.post("/api/channels/:channelId/sources/batch-delete", (req, res) => {
    const { channelId } = req.params;
    const { sourceIds } = req.body;
    if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
      return res.status(400).json({ error: "请提供要删除的直播线路 ID 列表" });
    }

    const channel = channels.find((c) => c.id === channelId);
    if (!channel) {
      return res.status(404).json({ error: "未找到频道" });
    }

    const initialCount = channel.sources.length;
    channel.sources = channel.sources.filter((s) => !sourceIds.includes(s.id));
    const deletedCount = initialCount - channel.sources.length;

    saveData();
    res.json({ success: true, count: deletedCount });
  });

  // Batch update live sources ISP and Province
  app.post("/api/channels/:channelId/sources/batch-update", (req, res) => {
    const { channelId } = req.params;
    const { sourceIds, isp, province, resolution } = req.body;
    if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
      return res.status(400).json({ error: "请提供要操作的直播线路 ID 列表" });
    }

    const channel = channels.find((c) => c.id === channelId);
    if (!channel) {
      return res.status(404).json({ error: "未找到频道" });
    }

    let updatedCount = 0;
    channel.sources.forEach((s) => {
      if (sourceIds.includes(s.id)) {
        if (isp !== undefined && isp !== null && isp !== "") {
          s.isp = isp;
        }
        if (province !== undefined && province !== null && province !== "") {
          s.province = province;
        }
        if (resolution !== undefined && resolution !== null && resolution !== "") {
          s.resolution = resolution;
        }
        updatedCount++;
      }
    });

    if (updatedCount > 0) {
      saveData();
    }
    res.json({ success: true, count: updatedCount });
  });

  // Global batch update live sources
  app.post("/api/sources/global-batch-update", (req, res) => {
    const { sourceIds, isp, province, status, resolution } = req.body;
    if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
      return res.status(400).json({ error: "请提供要操作的直播线路 ID 列表" });
    }

    let updatedCount = 0;
    channels.forEach((c) => {
      c.sources.forEach((s) => {
        if (sourceIds.includes(s.id)) {
          if (isp !== undefined && isp !== null && isp !== "") {
            s.isp = isp;
          }
          if (province !== undefined && province !== null && province !== "") {
            s.province = province;
          }
          if (status !== undefined && status !== null && status !== "") {
            s.status = status;
          }
          if (resolution !== undefined && resolution !== null && resolution !== "") {
            s.resolution = resolution;
          }
          updatedCount++;
        }
      });
    });

    if (updatedCount > 0) {
      saveData();
    }
    res.json({ success: true, count: updatedCount });
  });

  // Global batch isolate/restore live sources
  app.post("/api/sources/global-batch-isolate", (req, res) => {
    const { sourceIds, isolated } = req.body;
    if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
      return res.status(400).json({ error: "请提供要操作的直播线路 ID 列表" });
    }

    let updatedCount = 0;
    channels.forEach((c) => {
      c.sources.forEach((s) => {
        if (sourceIds.includes(s.id)) {
          s.isolated = !!isolated;
          updatedCount++;
        }
      });
    });

    if (updatedCount > 0) {
      saveData();
    }
    res.json({ success: true, count: updatedCount });
  });

  // Global batch delete live sources
  app.post("/api/sources/global-batch-delete", (req, res) => {
    const { sourceIds } = req.body;
    if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
      return res.status(400).json({ error: "请提供要删除的直播线路 ID 列表" });
    }

    let deletedCount = 0;

    channels.forEach((c) => {
      const initialCount = c.sources.length;
      c.sources = c.sources.filter((s) => !sourceIds.includes(s.id));
      deletedCount += (initialCount - c.sources.length);
    });

    if (deletedCount > 0) {
      saveData();
    }
    res.json({ success: true, count: deletedCount });
  });

  // Bulk Upload File Handler Endpoint
  app.post("/api/import/file", (req, res) => {
    const { content, type, aliasOnly } = req.body;
    if (!content) {
      return res.status(400).json({ error: "文件内容不能为空" });
    }

    try {
      const isM3u = type === "m3u" || content.includes("#EXTM3U");
      let importedChannelsCount = 0;
      let importedSourcesCount = 0;

      if (isM3u) {
        const lines = content.split(/\r?\n/);
        let currentInfo: any = null;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.startsWith("#EXTINF:")) {
            const logoMatch = line.match(/tvg-logo="([^"]+)"/) || line.match(/logo="([^"]+)"/);
            const groupMatch = line.match(/group-title="([^"]+)"/);
            const epgMatch = line.match(/tvg-id="([^"]+)"/) || line.match(/epg-id="([^"]+)"/);
            const tvgNameMatch = line.match(/tvg-name="([^"]+)"/);
            const aliasMatch = line.match(/tvg-alias="([^"]+)"/) || line.match(/alias="([^"]+)"/) || line.match(/alias-name="([^"]+)"/);
            
            const commaIndex = line.indexOf(",");
            let name = "未知频道";
            if (commaIndex !== -1) {
              name = line.substring(commaIndex + 1).trim();
            }
            name = stripBitrateAndResolution(name);

            const nameParts = name.split(/[,;，；:]/).map(s => s.trim()).filter(Boolean);
            if (nameParts.length > 0) {
              name = nameParts[0];
            }

            let parsedAliases = [...nameParts];
            if (tvgNameMatch && tvgNameMatch[1]) {
              parsedAliases.push(...tvgNameMatch[1].split(/[,;，；:]/).map(s => s.trim()).filter(Boolean));
            }
            if (aliasMatch && aliasMatch[1]) {
              parsedAliases.push(...aliasMatch[1].split(/[,;，；:]/).map(s => s.trim()).filter(Boolean));
            }
            parsedAliases = Array.from(new Set(parsedAliases));

            currentInfo = {
              name,
              logo: logoMatch ? logoMatch[1] : "",
              category: groupMatch ? groupMatch[1] : "手动导入",
              alias: parsedAliases,
              epgId: epgMatch ? epgMatch[1] : generateDefaultEpgId(name),
            };
          } else if (line && !line.startsWith("#") && currentInfo) {
            let url = line.split("$")[0].trim();
            const { province, isp } = parseIspAndProvince(currentInfo.name + " " + currentInfo.category);
            
            let isCarouselM3u = false;
            let carouselKeyM3u = null;
            const parsedCarouselM3u = parseCarouselUrl(url);
            if (parsedCarouselM3u.platform && parsedCarouselM3u.originalId) {
               isCarouselM3u = true;
               carouselKeyM3u = `@carousel:${parsedCarouselM3u.platform}_${parsedCarouselM3u.originalId}`;
               const registry = db.prepare("SELECT name FROM carousel_channels WHERE platform = ? AND originalId = ?").get(parsedCarouselM3u.platform, parsedCarouselM3u.originalId) as any;
               if (registry) {
                 currentInfo.name = registry.name;
               }
               detectAndRegisterCarouselProxy(url);
            }

            const catNames = (isCarouselM3u ? ["轮播频道"] : currentInfo.category.split(/[,;，；]/)).map((s: string) => s.trim()).filter(Boolean);

            if (catNames.length === 0) catNames.push("手动导入");

            const matchedGroupIds: string[] = [];
            for (const catName of catNames) {
              let existingGroup = groups.find((g) => g.name.toLowerCase() === catName.toLowerCase());
              if (!existingGroup) {
                if (autoCreateChannel) {
                  existingGroup = {
                    id: "g_" + Math.random().toString(36).substring(2, 10),
                    name: catName,
                  };
                  groups.push(existingGroup);
                  matchedGroupIds.push(existingGroup.id);
                }
              } else {
                matchedGroupIds.push(existingGroup.id);
              }
            }

            const stdInfo = findAliasTemplate(currentInfo.name);
            const lookupName = stdInfo ? stdInfo.templateName : currentInfo.name;

            let channel = channels.find(
              (c) => {
                 if (carouselKeyM3u) return c.alias.includes(carouselKeyM3u);
                 return normalizeChannelName(c.name) === normalizeChannelName(lookupName) ||
                 c.alias.some((a: string) => normalizeChannelName(a) === normalizeChannelName(lookupName)) ||
                 (stdInfo && stdInfo.aliases.some(a => normalizeChannelName(c.name) === normalizeChannelName(a) || c.alias.some(ca => normalizeChannelName(ca) === normalizeChannelName(a))));
              }
            );

            if (!channel) {
              if (!autoCreateChannel || aliasOnly) {
                currentInfo = null;
                continue;
              }
              const cleanName = stdInfo ? stdInfo.templateName : currentInfo.name;
              let cleanAliases = stdInfo
                ? Array.from(new Set([cleanName, currentInfo.name, ...stdInfo.aliases]))
                : currentInfo.alias;
              if (carouselKeyM3u) cleanAliases.push(carouselKeyM3u);

              channel = {
                id: "ch_" + Math.random().toString(36).substring(2, 10),
                name: cleanName,
                logo: currentInfo.logo || "https://images.unsplash.com/photo-1598257006458-087169a1f08d?auto=format&fit=crop&w=48&h=48&q=80",
                groupIds: matchedGroupIds,
                alias: cleanAliases,
                epgId: "",
                sources: [],
              };
              channels.push(channel);
              importedChannelsCount++;
            } else {
              if (stdInfo) {
                stdInfo.aliases.forEach(a => {
                  if (!channel!.alias.includes(a)) {
                    channel!.alias.push(a);
                  }
                });
              }
              // Add any aliases parsed from the current m3u metadata
              if (currentInfo && currentInfo.alias) {
                currentInfo.alias.forEach((a: string) => {
                  if (!channel!.alias.includes(a)) {
                    channel!.alias.push(a);
                  }
                });
              }
              // Update logo if provided in the M3U and current logo is invalid or system-generated
              if (currentInfo.logo && (!channel!.logo || channel!.logo.includes("unsplash.com"))) {
                channel!.logo = currentInfo.logo;
              }
            }

            if (aliasOnly) {
              currentInfo = null;
              continue;
            }

            if (!channel.sources.some((s) => s.url === url)) {
              channel.sources.push({
                id: "src_" + Math.random().toString(36).substring(2, 10),
                url,
                province,
                isp,
                status: "unknown",
              });
              importedSourcesCount++;
            }
            currentInfo = null;
          }
        }
      } else {
        // Parse TVBox TXT
        const lines = content.split(/\r?\n/);
        let currentCategory = "手动导入";

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;

          if (line.includes(",#genre")) {
            currentCategory = line.split(",")[0].trim();
          } else if (line.includes(",")) {
            const parts = line.split(",");
            const nameWithSpecs = parts[0].trim();
            const urls = parts[1].split('#').map(u => {
              let u2 = u.trim();
              if (u2.includes('$')) u2 = u2.split('$')[0].trim();
              return u2;
            }).filter(Boolean);
            if (urls.length === 0) continue;

            const { province, isp } = parseIspAndProvince(nameWithSpecs + " " + currentCategory);
            let name = nameWithSpecs.split("#")[0].trim();
            name = stripBitrateAndResolution(name);

            const nameParts = name.split(/[,;，；:]/).map(s => s.trim()).filter(Boolean);
            if (nameParts.length > 0) {
              name = nameParts[0];
            }

            let isCarouselTxt = false;
            for (const u of urls) {
               const parsedCarouselTxt = parseCarouselUrl(u);
               if (parsedCarouselTxt.platform && parsedCarouselTxt.originalId) {
                 isCarouselTxt = true;
                 const registry = db.prepare("SELECT name FROM carousel_channels WHERE platform = ? AND originalId = ?").get(parsedCarouselTxt.platform, parsedCarouselTxt.originalId) as any;
                 if (registry) {
                   name = registry.name;
                 }
                 detectAndRegisterCarouselProxy(u);
               }
            }
            const catNames = (isCarouselTxt ? ["轮播频道"] : currentCategory.split(/[,;，；]/)).map((s: string) => s.trim()).filter(Boolean);
            if (catNames.length === 0) catNames.push("手动导入");

            const matchedGroupIds: string[] = [];
            for (const catName of catNames) {
              let existingGroup = groups.find((g) => g.name.toLowerCase() === catName.toLowerCase());
              if (!existingGroup) {
                if (autoCreateChannel) {
                  existingGroup = {
                    id: "g_" + Math.random().toString(36).substring(2, 10),
                    name: catName,
                  };
                  groups.push(existingGroup);
                  matchedGroupIds.push(existingGroup.id);
                }
              } else {
                matchedGroupIds.push(existingGroup.id);
              }
            }

            const stdInfo = findAliasTemplate(name);
            const lookupName = stdInfo ? stdInfo.templateName : name;

            let channel = channels.find(
              (c) =>
                normalizeChannelName(c.name) === normalizeChannelName(lookupName) ||
                c.alias.some((a: string) => normalizeChannelName(a) === normalizeChannelName(lookupName)) ||
                (stdInfo && stdInfo.aliases.some(a => normalizeChannelName(c.name) === normalizeChannelName(a) || c.alias.some(ca => normalizeChannelName(ca) === normalizeChannelName(a))))
            );

            if (!channel) {
              if (!autoCreateChannel || aliasOnly) {
                continue;
              }
              const cleanName = stdInfo ? stdInfo.templateName : name;
              const cleanAliases = stdInfo 
                ? Array.from(new Set([cleanName, ...nameParts, ...stdInfo.aliases]))
                : Array.from(new Set(nameParts));

              channel = {
                id: "ch_" + Math.random().toString(36).substring(2, 10),
                name: cleanName,
                logo: "https://images.unsplash.com/photo-1598257006458-087169a1f08d?auto=format&fit=crop&w=48&h=48&q=80",
                groupIds: matchedGroupIds,
                alias: cleanAliases,
                epgId: generateDefaultEpgId(cleanName),
                sources: [],
              };
              channels.push(channel);
              importedChannelsCount++;
            } else {
              if (stdInfo) {
                // FORCE UPDATE channel name to the official alias template name
                channel.name = stdInfo.templateName;
                stdInfo.aliases.forEach(a => {
                  if (!channel!.alias.includes(a)) {
                    channel!.alias.push(a);
                  }
                });
              }
              // Add any aliases parsed from the current TXT metadata
              nameParts.forEach(a => {
                if (!channel!.alias.includes(a)) {
                  channel!.alias.push(a);
                }
              });
              channel!.alias = Array.from(new Set(channel!.alias));
            }

            if (aliasOnly) {
              continue;
            }

            for (const url of urls) {
              if (!channel.sources.some((s) => s.url === url)) {
                channel.sources.push({
                  id: "src_" + Math.random().toString(36).substring(2, 10),
                  url,
                  province,
                  isp,
                  status: "unknown",
                });
                importedSourcesCount++;
              }
            }
          }
        }
      }

      saveData();
      res.json({
        success: true,
        message: `成功导入 ${importedChannelsCount} 个频道，${importedSourcesCount} 个直播播放源`,
      });
    } catch (err: any) {
      res.status(500).json({ error: `解析文件出错: ${err.message || err}` });
    }
  });

  // Auto-Sync Config endpoints
  app.get("/api/sync-configs", (req, res) => {
    res.json(syncConfigs);
  });

  // Export sync configurations as a downloadable JSON file
  app.get("/api/sync-configs/export", (req, res) => {
    try {
      res.setHeader("Content-Disposition", "attachment; filename=\"iptv_sync_subscriptions.json\"");
      res.setHeader("Content-Type", "application/json");
      res.json(syncConfigs);
    } catch (err: any) {
      res.status(500).json({ error: `导出订阅失败: ${err.message || err}` });
    }
  });

  // Import sync configurations from JSON list
  app.post("/api/sync-configs/import", (req, res) => {
    try {
      const { configs, overwrite } = req.body;
      if (!Array.isArray(configs)) {
        return res.status(400).json({ error: "导入的备份格式不合法：期望一个 JSON 数组" });
      }

      const importedConfigs: SyncConfig[] = [];
      for (const item of configs) {
        if (!item.name || !item.url) {
          continue; // Skip invalid entries
        }
        importedConfigs.push({
          id: item.id && !overwrite ? item.id : "sc_" + Math.random().toString(36).substring(2, 10),
          name: String(item.name).trim(),
          url: String(item.url).trim(),
          type: item.type === "txt" ? "txt" : "m3u",
          status: item.status || "never",
          message: item.message || "",
          lastSynced: item.lastSynced,
          disabled: !!item.disabled,
          consecutiveFailures: Number(item.consecutiveFailures) || 0,
          contentHash: item.contentHash,
          isp: item.isp ? String(item.isp).trim() : undefined,
          aliasOnly: !!item.aliasOnly
        });
      }

      if (overwrite) {
        syncConfigs = importedConfigs;
      } else {
        // Merge - avoid duplicate URLs
        for (const imported of importedConfigs) {
          const existingIdx = syncConfigs.findIndex(c => c.url === imported.url);
          if (existingIdx >= 0) {
            // Update existing
            syncConfigs[existingIdx] = {
              ...syncConfigs[existingIdx],
              name: imported.name,
              type: imported.type,
              isp: imported.isp,
              aliasOnly: imported.aliasOnly
            };
          } else {
            syncConfigs.push(imported);
          }
        }
      }

      saveData();
      res.json({
        success: true,
        message: `成功导入 ${importedConfigs.length} 项同步订阅配置`,
        syncConfigs
      });
    } catch (err: any) {
      res.status(500).json({ error: `导入订阅失败: ${err.message || err}` });
    }
  });

  app.post("/api/sync-configs", (req, res) => {
    const { name, url, type, isp, aliasOnly } = req.body;
    if (!name || !url) {
      return res.status(400).json({ error: "同步名称和URL为必填项" });
    }

    const newConfig: SyncConfig = {
      id: "sc_" + Math.random().toString(36).substring(2, 10),
      name,
      url,
      type: type || "m3u",
      status: "never",
      isp: isp ? String(isp).trim() : undefined,
      aliasOnly: !!aliasOnly
    };

    syncConfigs.push(newConfig);
    saveData();
    res.status(201).json(newConfig);
  });

  app.put("/api/sync-configs/:id", (req, res) => {
    const { id } = req.params;
    const { name, url, type, isp, disabled, aliasOnly } = req.body;

    const config = syncConfigs.find((c) => c.id === id);
    if (!config) {
      return res.status(404).json({ error: "同步配置未找到" });
    }

    if (name) config.name = name;
    if (url && url !== config.url) {
      config.url = url;
      config.contentHash = undefined;
      config.disabled = false;
      config.consecutiveFailures = 0;
    } else if (url) {
      config.url = url;
    }
    if (type) config.type = type;
    if (isp !== undefined) {
      config.isp = isp ? String(isp).trim() : undefined;
    }
    if (aliasOnly !== undefined) {
      config.aliasOnly = !!aliasOnly;
    }
    if (disabled !== undefined) {
      config.disabled = !!disabled;
      if (disabled === false) {
        config.consecutiveFailures = 0;
      }
    }

    saveData();
    res.json(config);
  });

  app.delete("/api/sync-configs/:id", (req, res) => {
    const { id } = req.params;
    const initialLength = syncConfigs.length;
    syncConfigs = syncConfigs.filter((c) => c.id !== id);

    if (syncConfigs.length === initialLength) {
      return res.status(404).json({ error: "同步配置未找到" });
    }

    saveData();
    res.json({ success: true, message: "同步配置删除成功" });
  });

  // Batch Run All Active Sync Configs
  app.post("/api/sync-configs/run-all", async (req, res) => {
    const activeConfigs = syncConfigs.filter((c) => !c.disabled);
    if (activeConfigs.length === 0) {
      return res.json({ success: true, message: "没有发现任何未禁用的订阅源", syncConfigs });
    }

    let successCount = 0;
    let failCount = 0;

    // Execute in parallel
    const promises = activeConfigs.map(async (config) => {
      config.status = "never";
      config.message = "正在进行后台批量同步...";
      config.consecutiveFailures = 0;
      const success = await performSync(config, true);
      if (success) {
        successCount++;
      } else {
        failCount++;
      }
    });

    await Promise.all(promises);
    saveData();

    res.json({
      success: true,
      message: `批量订阅同步完成：成功 ${successCount} 个，失败 ${failCount} 个`,
      syncConfigs
    });
  });

  // Manually Run Sync
  app.post("/api/sync-configs/:id/run", async (req, res) => {
    const { id } = req.params;
    const config = syncConfigs.find((c) => c.id === id);
    if (!config) {
      return res.status(404).json({ error: "同步配置未找到" });
    }

    config.status = "never";
    config.message = "正在进行后台同步...";
    config.disabled = false;
    config.consecutiveFailures = 0;
    
    // Run sync asynchronously forcing update on manual trigger
    const success = await performSync(config, true);
    if (success) {
      res.json({ success: true, message: "同步完成", config });
    } else {
      res.status(500).json({ error: "同步失败", config });
    }
  });

  // Link validation & latency speed checking triggered by browser
  app.post("/api/sources/test", (req, res) => {
    const { sourceIds, channelIds, concurrency, isp, province, status } = req.body;

    if (testStatus.status === "running") {
      return res.status(400).json({ error: "已有正在运行的批量测速任务" });
    }

    // Capture files to check
    let targetSources: { id: string; channelId: string; url: string }[] = [];

    channels.forEach((channel) => {
      if (channel.isolated) return;
      if (channelIds && !channelIds.includes(channel.id)) return;
      channel.sources.forEach((source) => {
        if (source.isolated) return;
        // Apply filter constraints if specified
        if (sourceIds && !sourceIds.includes(source.id)) return;
        if (isp && isp !== "all" && source.isp !== isp) return;
        if (province && province !== "all" && source.province !== province) return;
        if (status && status !== "all" && source.status !== status) return;

        // 服务端全网异步多线程测速，只针对多线直播源，不对指定isp的线路测速
        const specificISPs = ["电信", "联通", "移动", "广电", "铁通"];
        if (source.isp && specificISPs.includes(source.isp)) {
          return;
        }

        targetSources.push({
          id: source.id,
          channelId: channel.id,
          url: source.url,
        });
      });
    });

    if (targetSources.length === 0) {
      return res.status(400).json({ error: "未选择或未检索到符合过滤条件的直播源进行测试" });
    }

    // Run task asynchronously
    const targetConcurrency = Number(concurrency) || 8;
    runConcurrentTest(targetSources, targetConcurrency);

    res.json({
      success: true,
      message: "批量多线程测速任务启动成功",
      task: {
        total: targetSources.length,
        status: "running"
      }
    });
  });

    // Endpoint to fetch test list for client/browser probes, filtered by ISP + BGP/多线/未知, independent of UI filters
  app.get("/api/sources/client-test-list", (req, res) => {
    const clientIsp = ((req.query.isp as string) || "").trim();
    const clientProvince = ((req.query.province as string) || "").trim();
    const onlyActive = req.query.onlyActive === "true";
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 0;
    const page = req.query.page ? parseInt(req.query.page as string) : 1;

    const targetSources: any[] = [];

    channels.forEach((channel) => {
      if (channel.isolated) return;
      if (!channel.sources) return;
      channel.sources.forEach((s) => {
        if (s.isolated) return;

        if (onlyActive && s.status !== "active" && s.status !== "unknown" && s.status !== "checking") {
          return;
        }

        let isIspMatch = false;
        if (!clientIsp || clientIsp === "all" || clientIsp === "全部") {
          isIspMatch = true;
        } else {
          const sIsp = (s.isp || "").toLowerCase();
          const cIsp = clientIsp.toLowerCase();

          if (!sIsp || sIsp === "未知" || sIsp.includes("bgp") || sIsp.includes("多线") || sIsp.includes("混合") || sIsp.includes("全网")) {
            isIspMatch = true;
          } else if (sIsp.includes(cIsp) || cIsp.includes(sIsp)) {
            isIspMatch = true;
          }
        }

        if (isIspMatch) {
          targetSources.push({
            id: s.id,
            channelId: channel.id,
            channelName: channel.name,
            url: s.url,
            isp: s.isp || "未知",
            province: s.province || "全国",
            status: s.status || "unknown",
            latency: s.latency,
            resolution: s.resolution
          });
        }
      });
    });

    const totalCount = targetSources.length;
    let paginatedSources = targetSources;
    
    if (limit > 0) {
      const startIndex = (page - 1) * limit;
      paginatedSources = targetSources.slice(startIndex, startIndex + limit);
    }

    res.json({
      success: true,
      count: paginatedSources.length,
      total: totalCount,
      page: limit > 0 ? page : 1,
      limit: limit > 0 ? limit : totalCount,
      clientIsp: clientIsp || "全部",
      clientProvince: clientProvince || "全国",
      sources: paginatedSources
    });
  });

  // Option 2: Endpoint for client-side/browser speed test report submission
  app.post("/api/sources/client-test-results", (req, res) => {
    const { results, clientIsp, clientProvince } = req.body;
    if (!Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ error: "请提供有效的客户端代测结果报告数据" });
    }

    let updatedCount = 0;
    results.forEach((r: any) => {
      const { sourceId, channelId, status, latency, resolution } = r;
      if (!sourceId || !status) return;

      channels.forEach((c) => {
        if (channelId && c.id !== channelId) return;
        const src = c.sources.find((s) => s.id === sourceId);
        if (src) {
          // Update test counts
          src.testCount = (src.testCount || 0) + 1;
          if (status === "active") {
            src.successCount = (src.successCount || 0) + 1;
          }

          if (resolution) {
            src.resolution = resolution;
          }

          // Exponential Moving Average for latency to smooth out anomalies
          if (latency !== undefined && latency > 0) {
            if (src.latency && src.latency > 0) {
               src.latency = Math.round(src.latency * 0.7 + latency * 0.3);
            } else {
               src.latency = latency;
            }
          }

          // Smart ISP/Province Discovery:
          // If the source lacks ISP/Province info, and the client had a great connection (<100ms)
          if (status === "active" && latency !== undefined && latency <= 100) {
            if ((!src.isp || src.isp === "未知") && clientIsp) {
              src.isp = clientIsp;
            }
            if ((!src.province || src.province === "未知") && clientProvince) {
              src.province = clientProvince;
            }
          }

          // Decide status based on reliability if we have enough tests
          // E.g., if it failed now, but has > 50% success rate historically, we might keep it active
          // But to be responsive to actual outages, we just use the latest status.
          if (isPrivateOrIntranetUrl(src.url) && status === "inactive") {
            src.status = "active";
          } else {
            src.status = status;
          }
          src.lastChecked = new Date().toISOString();
          
          src.clientIspReported = clientIsp || "宿主";
          src.clientProvinceReported = clientProvince || "本地";
          updatedCount++;
        }
      });
    });

    // Save test report history
    try {
      const reportId = Date.now().toString() + Math.random().toString(36).substring(2, 7);
      const activeCount = results.filter(r => r.status === 'active').length;
      const inactiveCount = results.filter(r => r.status === 'inactive').length;
      
      const stmt = db.prepare(`
        INSERT INTO test_reports (id, createdAt, totalTested, activeCount, inactiveCount, clientIsp, clientProvince, details)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        reportId,
        new Date().toISOString(),
        results.length,
        activeCount,
        inactiveCount,
        clientIsp || "",
        clientProvince || "",
        JSON.stringify(results)
      );
    } catch (e) {
      console.error("Error saving test report:", e);
    }

    if (updatedCount > 0) {
      saveData();
    }
    res.json({ success: true, count: updatedCount });
  });

  // REST API for test reports

  
  app.get("/api/carousel-discovery-rules", (req, res) => {
    try {
      res.json(getDiscoveryRules(true));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/carousel-discovery-rules/preset", (req, res) => {
    try {
      const { mode } = req.body || {};
      const overwrite = mode === "reset";
      const added = seedKnownRules(overwrite);
      const totalRules = getDiscoveryRules(true);
      res.json({
        success: true,
        addedCount: added,
        total: totalRules.length,
        rules: totalRules,
        message: overwrite
          ? `重置并预置已知规则成功！共加载 ${totalRules.length} 条常见平台特征规则。`
          : `已知特征规则增量补充成功！补充新增 ${added} 条规则，当前共 ${totalRules.length} 条规则。`
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/carousel-discovery-rules", (req, res) => {
    const { platform, keyword, enabled = 1 } = req.body;
    if (!platform || !keyword) return res.status(400).json({ error: "Missing fields" });
    try {
      const id = crypto.randomUUID();
      db.prepare('INSERT INTO carousel_discovery_rules (id, platform, keyword, enabled) VALUES (?, ?, ?, ?)').run(
        id,
        platform.trim().toLowerCase(),
        keyword.trim(),
        enabled !== undefined ? (enabled ? 1 : 0) : 1
      );
      discoveryRulesCache = null; // Invalidate cache
      res.json({ id, platform: platform.trim().toLowerCase(), keyword: keyword.trim(), enabled: enabled ? 1 : 0 });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/carousel-discovery-rules/:id", (req, res) => {
    const { id } = req.params;
    const { platform, keyword, enabled } = req.body;
    try {
      const current = db.prepare('SELECT * FROM carousel_discovery_rules WHERE id = ?').get(id) as any;
      if (!current) {
        return res.status(404).json({ error: "未找到该发现规则" });
      }
      db.prepare(`
        UPDATE carousel_discovery_rules
        SET platform = ?, keyword = ?, enabled = ?
        WHERE id = ?
      `).run(
        platform !== undefined ? platform.trim().toLowerCase() : current.platform,
        keyword !== undefined ? keyword.trim() : current.keyword,
        enabled !== undefined ? (enabled ? 1 : 0) : (current.enabled ?? 1),
        id
      );
      discoveryRulesCache = null;
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/carousel-discovery-rules/batch-delete", (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "未选择要删除的规则" });
    }
    try {
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(`DELETE FROM carousel_discovery_rules WHERE id IN (${placeholders})`).run(...ids);
      discoveryRulesCache = null;
      res.json({ success: true, count: ids.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/carousel-discovery-rules/:id", (req, res) => {
    try {
      db.prepare('DELETE FROM carousel_discovery_rules WHERE id = ?').run(req.params.id);
      discoveryRulesCache = null; // Invalidate cache
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Disabled Discovery Rules API (禁用代理发现规则 / 黑名单) ---

  app.get("/api/carousel-disabled-rules", (req, res) => {
    try {
      res.json(getDisabledRules());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/carousel-disabled-rules", (req, res) => {
    const { pattern, type = 'contains', platform = '', description = '', enabled = 1 } = req.body;
    if (!pattern || !pattern.trim()) {
      return res.status(400).json({ error: "规则匹配内容为必填项" });
    }
    try {
      const id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO carousel_disabled_rules (id, pattern, type, platform, description, enabled)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, pattern.trim(), type || 'contains', platform || '', description || '', enabled !== undefined ? (enabled ? 1 : 0) : 1);
      disabledRulesCache = null;
      cleanupBlockedCarouselProxies();
      res.json({ id, pattern: pattern.trim(), type, platform, description, enabled: enabled ? 1 : 0 });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/carousel-disabled-rules/:id", (req, res) => {
    const { id } = req.params;
    const { pattern, type, platform, description, enabled } = req.body;
    try {
      const current = db.prepare('SELECT * FROM carousel_disabled_rules WHERE id = ?').get(id) as any;
      if (!current) {
        return res.status(404).json({ error: "未找到该禁用规则" });
      }
      db.prepare(`
        UPDATE carousel_disabled_rules
        SET pattern = ?, type = ?, platform = ?, description = ?, enabled = ?
        WHERE id = ?
      `).run(
        pattern !== undefined ? pattern.trim() : current.pattern,
        type !== undefined ? type : current.type,
        platform !== undefined ? platform : current.platform,
        description !== undefined ? description : current.description,
        enabled !== undefined ? (enabled ? 1 : 0) : current.enabled,
        id
      );
      disabledRulesCache = null;
      cleanupBlockedCarouselProxies();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/carousel-disabled-rules/:id", (req, res) => {
    try {
      db.prepare('DELETE FROM carousel_disabled_rules WHERE id = ?').run(req.params.id);
      disabledRulesCache = null;
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/carousel-disabled-rules/preset", (req, res) => {
    try {
      const { mode } = req.body || {};
      const overwrite = mode === "reset";
      const added = seedDisabledRules(overwrite);
      const rules = getDisabledRules();
      const purged = cleanupBlockedCarouselProxies();
      res.json({
        success: true,
        addedCount: added,
        purgedCount: purged,
        total: rules.length,
        rules,
        message: overwrite
          ? `重置并预置禁用发现规则成功！共加载 ${rules.length} 条内置忽略规则，并清理了 ${purged} 个违规代理模板。`
          : `内置忽略规则增量补充成功！补充新增 ${added} 条规则，当前共 ${rules.length} 条规则。`
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/carousel-disabled-rules/batch", (req, res) => {
    const { lines, type = 'contains', platform = '', description = '' } = req.body;
    if (!lines || typeof lines !== 'string') {
      return res.status(400).json({ error: "请提供多行规则文本" });
    }
    try {
      const rawPatterns = lines.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      let added = 0;
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO carousel_disabled_rules (id, pattern, type, platform, description, enabled)
        VALUES (?, ?, ?, ?, ?, 1)
      `);
      for (const pat of rawPatterns) {
        const info = stmt.run(crypto.randomUUID(), pat, type || 'contains', platform || '', description || '');
        if (info.changes > 0) added++;
      }
      disabledRulesCache = null;
      const purged = cleanupBlockedCarouselProxies();
      res.json({ success: true, addedCount: added, purgedCount: purged, total: getDisabledRules().length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/carousel-disabled-rules/apply-cleanup", (req, res) => {
    try {
      const purged = cleanupBlockedCarouselProxies();
      const remaining = (db.prepare('SELECT COUNT(*) as count FROM carousel_proxies').get() as any).count;
      res.json({ success: true, purgedCount: purged, remainingCount: remaining });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Carousel Channels Management API ---

  app.get("/api/carousel-channels", (req, res) => {
    try {
      const rows = db.prepare("SELECT c.id, c.channelId, COALESCE(NULLIF(c.name, ''), NULLIF(ch.name, ''), '未知频道') as name, c.platform, c.originalId FROM carousel_channels c LEFT JOIN channels ch ON c.channelId = ch.id").all();
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/carousel-channels", (req, res) => {
    const { name, platform, originalId } = req.body;
    if (!name || !platform || !originalId) return res.status(400).json({ error: "Missing required fields" });
    const id = crypto.randomUUID();
    try {
      let ch = db.prepare('SELECT id FROM channels WHERE id = ?').get(req.body.channelId);
      if (!ch && name) {
        const nid = crypto.randomUUID();
        db.prepare('INSERT INTO channels (id, name, logo, groupIds, alias, epgId) VALUES (?, ?, ?, ?, ?, ?)').run(nid, name, '', '[]', '[]', '');
        req.body.channelId = nid;
      }
      db.prepare('INSERT INTO carousel_channels (id, channelId, name, platform, originalId) VALUES (?, ?, ?, ?, ?)').run(id, req.body.channelId || '', name || '', platform, originalId);
      syncCarouselSources();
      res.json({ id, name, platform, originalId });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/carousel-channels/:id", (req, res) => {
    const { id } = req.params;
    const { name, platform, originalId } = req.body;
    try {
      db.prepare('UPDATE carousel_channels SET name = ?, channelId = ?, platform = ?, originalId = ? WHERE id = ?').run(name || '', req.body.channelId || '', platform, originalId, id);
      syncCarouselSources();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/carousel-channels/:id", (req, res) => {
    const { id } = req.params;
    try {
      db.prepare('DELETE FROM carousel_channels WHERE id = ?').run(id);
      syncCarouselSources();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/carousel-channels-unregistered", (req, res) => {
    try {
      // Exclude isolated sources and sources belonging to isolated channels
      const allSources = db.prepare(`
        SELECT s.url, c.name as channelName 
        FROM sources s 
        JOIN channels c ON s.channelId = c.id 
        WHERE (s.isolated = 0 OR s.isolated IS NULL) 
          AND (c.isolated = 0 OR c.isolated IS NULL)
      `).all() as any[];
      const existingChannels = db.prepare('SELECT platform, originalId FROM carousel_channels').all() as any[];
      const existingSet = new Set(existingChannels.map((c: any) => `${c.platform}_${c.originalId}`));

      // Also gather from in-memory channels (skipping isolated)
      const inMemorySources: { url: string; channelName: string }[] = [];
      for (const ch of channels) {
        if (ch.isolated) continue;
        if (ch.sources) {
          for (const s of ch.sources) {
            if (s.isolated) continue;
            if (s.url) {
              inMemorySources.push({ url: s.url, channelName: ch.name });
            }
          }
        }
      }
      const combinedSources = allSources.length > 0 ? allSources : inMemorySources;

      const map = new Map();
      for (const row of combinedSources) {
        if (!row.url || isUrlBlockedByDisabledRules(row.url)) continue;
        const parsed = parseCarouselUrl(row.url);
        if (parsed.platform && parsed.originalId) {
          const key = `${parsed.platform}_${parsed.originalId}`;
          if (!existingSet.has(key)) {
            if (!map.has(key)) {
              map.set(key, { platform: parsed.platform, originalId: parsed.originalId, sampleNames: new Set() });
            }
            map.get(key).sampleNames.add(row.channelName);
          }
        }
      }
      const results = Array.from(map.values()).map((v: any) => ({
        ...v,
        sampleNames: Array.from(v.sampleNames)
      }));
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/carousel-channels/batch", (req, res) => {
    const { items } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: "Invalid payload" });
    try {
      const stmt = db.prepare('INSERT INTO carousel_channels (id, channelId, name, platform, originalId) VALUES (?, ?, ?, ?, ?)');
      const insertMany = db.transaction((itemsToInsert) => {
        for (const item of itemsToInsert) {
           const exists = db.prepare('SELECT id FROM carousel_channels WHERE platform = ? AND originalId = ?').get(item.platform, item.originalId);
           if (!exists) {
             let ch = db.prepare('SELECT id FROM channels WHERE name = ?').get(item.name) as any;
             if (!ch) {
               const nid = crypto.randomUUID();
               db.prepare('INSERT INTO channels (id, name, logo, groupIds, alias, epgId) VALUES (?, ?, ?, ?, ?, ?)').run(nid, item.name, '', '[]', '[]', '');
               ch = { id: nid };
             }
             stmt.run(crypto.randomUUID(), ch.id, item.name, item.platform, item.originalId);
           }
        }
      });
      insertMany(items);
      syncCarouselSources();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/carousel-channels/batch-delete", (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: "Invalid payload" });
    try {
      const stmt = db.prepare('DELETE FROM carousel_channels WHERE id = ?');
      const deleteMany = db.transaction((idsToDelete) => {
        for (const id of idsToDelete) stmt.run(id);
      });
      deleteMany(ids);
      syncCarouselSources();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/carousel-channels-apply", (req, res) => {
    try {
      // 1. Scan and register any proxy templates discovered in current sources if any
      try {
        scanAndRegisterAllCarouselProxies();
      } catch (e) {}

      // 2. Perform carousel sources synchronization
      const stats = syncCarouselSources();

      const registriesCount = (db.prepare('SELECT COUNT(*) as count FROM carousel_channels').get() as any).count;
      const proxiesCount = (db.prepare('SELECT COUNT(*) as count FROM carousel_proxies').get() as any).count;
      const activeProxiesCount = (db.prepare("SELECT COUNT(*) as count FROM carousel_proxies WHERE status = 'active'").get() as any).count;

      let message = "";
      if (stats.createdCount > 0 || stats.updatedCount > 0) {
        message = `已成功同步生成 ${stats.createdCount} 个新直播源，归类 ${stats.updatedCount} 条现有源（当前共 ${stats.totalCount} 个有效轮播源，覆盖 ${stats.channelsCount} 个频道）！`;
      } else if (stats.totalCount > 0) {
        message = `所有 ${stats.channelsCount} 个轮播频道的直播源（共 ${stats.totalCount} 条线路）均已处于最新同步状态，无需重复生成。`;
      } else if (activeProxiesCount === 0) {
        message = `已同步 ${registriesCount} 个频道映射，但系统当前没有启用的轮播代理模板（可用代理: 0/${proxiesCount}）。请先前往【轮播代理】配置并启用可用代理，或点击【从现有源自动提取】！`;
      } else if (registriesCount === 0) {
        message = `当前映射列表为空，请先在【未识别项发现】中添加频道映射或手动添加映射！`;
      } else {
        message = `已同步 ${registriesCount} 个频道映射，未匹配到对应平台的可用代理模板。`;
      }

      res.json({
        success: true,
        createdSourcesCount: stats.createdCount,
        updatedCount: stats.updatedCount,
        totalSourcesCount: stats.totalCount,
        channelsCount: stats.channelsCount,
        activeProxiesCount,
        totalProxiesCount: proxiesCount,
        registriesCount,
        message
      });
    } catch (e: any) {
      console.error("[carousel-channels-apply error]", e);
      res.status(500).json({ error: e.message || "应用生成频道源失败" });
    }
  });

  // --- Carousel Proxy Management API ---
  
  app.get("/api/carousel-proxies", (req, res) => {
    try {
      cleanupBlockedCarouselProxies();
      const proxies = db.prepare('SELECT * FROM carousel_proxies').all() as any[];
      const enabledRules = getDiscoveryRules(false);
      const enabledPlatforms = new Set(enabledRules.map((r: any) => (r.platform || '').toLowerCase()));
      const hasDiscoveryRules = (db.prepare('SELECT COUNT(*) as count FROM carousel_discovery_rules').get() as any).count > 0;

      const annotated = proxies.map((p: any) => {
        const plat = (p.platform || '').toLowerCase();
        let isBlocked = isUrlBlockedByDisabledRules(p.urlTemplate, p.platform);
        let blockedReason = isBlocked ? "命中禁用发现规则 (黑名单)" : "";

        if (!isBlocked && hasDiscoveryRules && !enabledPlatforms.has(plat)) {
          isBlocked = true;
          blockedReason = `所属平台 [${plat.toUpperCase()}] 特征发现规则已停用`;
        }

        return {
          ...p,
          isBlocked: Boolean(isBlocked),
          blockedReason
        };
      });

      res.json(annotated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/carousel-proxies/scan-sources", (req, res) => {
    try {
      cleanupBlockedCarouselProxies();
      try {
        db.prepare('DELETE FROM deleted_carousel_proxies').run();
      } catch (e) {}

      let added = 0;
      // Scan sources in memory (ignoring isolated channels and sources)
      for (const ch of channels) {
        if (ch.isolated) continue;
        if (ch && ch.sources) {
          for (const s of ch.sources) {
            if (s.isolated) continue;
            if (s && s.url && !isUrlBlockedByDisabledRules(s.url)) {
              const beforeCount = (db.prepare('SELECT COUNT(*) as count FROM carousel_proxies').get() as any).count;
              detectAndRegisterCarouselProxy(s.url, true);
              const afterCount = (db.prepare('SELECT COUNT(*) as count FROM carousel_proxies').get() as any).count;
              if (afterCount > beforeCount) {
                added += (afterCount - beforeCount);
              }
            }
          }
        }
      }
      // Scan sources in SQLite if any (ignoring isolated sources and channels)
      const sqlAdded = scanAndRegisterAllCarouselProxies(true);
      added += sqlAdded;

      const proxies = db.prepare('SELECT * FROM carousel_proxies').all();
      res.json({ success: true, count: added, total: proxies.length, proxies });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/carousel-proxies", (req, res) => {
    const { platform, urlTemplate, status = 'active' } = req.body;
    if (!platform || !urlTemplate) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const id = crypto.randomUUID();
    try {
      // If previously marked as deleted, unmark it
      try {
        db.prepare('DELETE FROM deleted_carousel_proxies WHERE urlTemplate = ?').run(urlTemplate);
      } catch (e) {}

      db.prepare('INSERT INTO carousel_proxies (id, platform, urlTemplate, status) VALUES (?, ?, ?, ?)').run(id, platform, urlTemplate, status);
      if (status === 'active') {
        syncCarouselSources();
      }
      res.json({ id, platform, urlTemplate, status });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/carousel-proxies/:id", async (req, res) => {
    const { id } = req.params;
    const { platform, urlTemplate, status, test } = req.body;
    try {
      const existing = db.prepare('SELECT * FROM carousel_proxies WHERE id = ?').get(id) as any;
      if (!existing) {
        return res.status(404).json({ error: "未找到该代理" });
      }

      const nextPlatform = platform || existing.platform;
      const nextUrl = urlTemplate || existing.urlTemplate;
      const nextStatus = status !== undefined ? status : existing.status;

      if (nextUrl) {
        try {
          db.prepare('DELETE FROM deleted_carousel_proxies WHERE urlTemplate = ?').run(nextUrl);
        } catch (e) {}
      }

      // If enabling or restoring (status === 'active')
      if (nextStatus === 'active') {
        if (test !== false) {
          const testRes = await testCarouselProxyAvailability({ platform: nextPlatform, urlTemplate: nextUrl });
          if (!testRes.available) {
            db.prepare('UPDATE carousel_proxies SET platform = ?, urlTemplate = ?, status = ? WHERE id = ?').run(nextPlatform, nextUrl, 'inactive', id);
            removeSourcesForProxyTemplates([existing, { platform: nextPlatform, urlTemplate: nextUrl }]);
            syncCarouselSources();
            return res.json({
              success: false,
              available: false,
              status: 'inactive',
              error: `代理测试不可用: ${testRes.error || '连接失败'}，未恢复直播源`
            });
          }

          db.prepare('UPDATE carousel_proxies SET platform = ?, urlTemplate = ?, status = ? WHERE id = ?').run(nextPlatform, nextUrl, 'active', id);
          syncCarouselSources();
          return res.json({
            success: true,
            available: true,
            status: 'active',
            latency: testRes.latency,
            message: `代理测试可用 (${testRes.latency}ms)，已恢复并同步添加直播源`
          });
        } else {
          db.prepare('UPDATE carousel_proxies SET platform = ?, urlTemplate = ?, status = ? WHERE id = ?').run(nextPlatform, nextUrl, 'active', id);
          syncCarouselSources();
          return res.json({ success: true, status: 'active', message: '已强制启用并添加对应直播源' });
        }
      } else {
        // Disabling proxy ('inactive' or 'disabled')
        db.prepare('UPDATE carousel_proxies SET platform = ?, urlTemplate = ?, status = ? WHERE id = ?').run(nextPlatform, nextUrl, 'inactive', id);
        removeSourcesForProxyTemplates([existing, { platform: nextPlatform, urlTemplate: nextUrl }]);
        syncCarouselSources();
        return res.json({ success: true, status: 'inactive', message: '代理已禁用，对应直播源已移除' });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Single proxy toggle status
  app.post("/api/carousel-proxies/:id/toggle-status", async (req, res) => {
    const { id } = req.params;
    const { status, test = true } = req.body;
    try {
      const proxy = db.prepare('SELECT * FROM carousel_proxies WHERE id = ?').get(id) as any;
      if (!proxy) return res.status(404).json({ error: "代理不存在" });

      const targetStatus = status || (proxy.status === 'active' ? 'inactive' : 'active');

      if (targetStatus === 'active') {
        if (test !== false) {
          const testRes = await testCarouselProxyAvailability(proxy);
          if (!testRes.available) {
            db.prepare('UPDATE carousel_proxies SET status = ? WHERE id = ?').run('inactive', id);
            removeSourcesForProxyTemplates([proxy]);
            syncCarouselSources();
            return res.json({
              success: false,
              available: false,
              status: 'inactive',
              error: `代理测试不可用: ${testRes.error || '连接失败'}，未恢复直播源`
            });
          }

          db.prepare('UPDATE carousel_proxies SET status = ? WHERE id = ?').run('active', id);
          syncCarouselSources();
          return res.json({
            success: true,
            available: true,
            status: 'active',
            latency: testRes.latency,
            message: `代理测试可用 (${testRes.latency}ms)，已恢复启用并添加对应直播源`
          });
        } else {
          db.prepare('UPDATE carousel_proxies SET status = ? WHERE id = ?').run('active', id);
          syncCarouselSources();
          return res.json({ success: true, status: 'active', message: '已启用代理并添加对应直播源' });
        }
      } else {
        // Disabling
        db.prepare('UPDATE carousel_proxies SET status = ? WHERE id = ?').run('inactive', id);
        removeSourcesForProxyTemplates([proxy]);
        syncCarouselSources();
        return res.json({ success: true, status: 'inactive', message: '代理已禁用，对应直播源已移除' });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Single proxy test availability
  app.post("/api/carousel-proxies/:id/test", async (req, res) => {
    const { id } = req.params;
    try {
      const proxy = db.prepare('SELECT * FROM carousel_proxies WHERE id = ?').get(id) as any;
      if (!proxy) return res.status(404).json({ error: "代理不存在" });

      const testRes = await testCarouselProxyAvailability(proxy);
      if (testRes.available) {
        db.prepare('UPDATE carousel_proxies SET status = ? WHERE id = ?').run('active', id);
        syncCarouselSources();
      } else {
        db.prepare('UPDATE carousel_proxies SET status = ? WHERE id = ?').run('inactive', id);
        removeSourcesForProxyTemplates([proxy]);
        syncCarouselSources();
      }
      res.json({
        success: true,
        ...testRes,
        status: testRes.available ? 'active' : 'inactive'
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Batch toggle status (Batch Enable / Batch Disable)
  app.post("/api/carousel-proxies/batch-status", async (req, res) => {
    const { ids, status, test = true } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "Missing ids array" });
    }
    if (status !== 'active' && status !== 'inactive' && status !== 'disabled') {
      return res.status(400).json({ error: "Invalid status value" });
    }

    try {
      const placeholders = ids.map(() => '?').join(',');
      const proxies = db.prepare(`SELECT * FROM carousel_proxies WHERE id IN (${placeholders})`).all(...ids) as any[];

      if (status === 'inactive' || status === 'disabled') {
        // Batch disable: set status to inactive and remove corresponding live sources
        db.prepare(`UPDATE carousel_proxies SET status = 'inactive' WHERE id IN (${placeholders})`).run(...ids);
        removeSourcesForProxyTemplates(proxies);
        syncCarouselSources();
        return res.json({
          success: true,
          status: 'inactive',
          count: proxies.length,
          message: `已批量禁用 ${proxies.length} 个代理，对应直播源已全部移除`
        });
      }

      // Batch enable (restore): test availability for each unless test === false
      if (test === false) {
        db.prepare(`UPDATE carousel_proxies SET status = 'active' WHERE id IN (${placeholders})`).run(...ids);
        syncCarouselSources();
        return res.json({
          success: true,
          status: 'active',
          activatedCount: proxies.length,
          failedCount: 0,
          message: `已强制启用选中的 ${proxies.length} 个代理并添加直播源`
        });
      }

      const results: any[] = [];
      let activatedCount = 0;
      let failedCount = 0;

      await Promise.all(proxies.map(async (proxy) => {
        const testRes = await testCarouselProxyAvailability(proxy);
        if (testRes.available) {
          db.prepare('UPDATE carousel_proxies SET status = ? WHERE id = ?').run('active', proxy.id);
          activatedCount++;
          results.push({ id: proxy.id, platform: proxy.platform, available: true, latency: testRes.latency });
        } else {
          db.prepare('UPDATE carousel_proxies SET status = ? WHERE id = ?').run('inactive', proxy.id);
          failedCount++;
          results.push({ id: proxy.id, platform: proxy.platform, available: false, error: testRes.error });
        }
      }));

      // Sync sources (will add for active and remove for inactive)
      syncCarouselSources();

      return res.json({
        success: true,
        activatedCount,
        failedCount,
        total: proxies.length,
        results,
        message: activatedCount > 0
          ? `恢复测试完成: ${activatedCount} 个代理可用已恢复并添加直播源` + (failedCount > 0 ? ` (${failedCount} 个不可用保持禁用)` : '')
          : `选中的 ${failedCount} 个代理测试均不可用，已保持禁用且未添加直播源`
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/carousel-proxies/:id", (req, res) => {
    const { id } = req.params;
    try {
      const proxy = db.prepare('SELECT id, platform, urlTemplate FROM carousel_proxies WHERE id = ?').get(id) as any;
      if (proxy && proxy.urlTemplate) {
        try {
          db.prepare('INSERT OR REPLACE INTO deleted_carousel_proxies (urlTemplate, deletedAt) VALUES (?, ?)').run(
            proxy.urlTemplate,
            new Date().toISOString()
          );
        } catch (e) {}
        // Remove all corresponding live stream sources
        removeSourcesForProxyTemplates([proxy]);
      }
      db.prepare('DELETE FROM carousel_proxies WHERE id = ?').run(id);
      syncCarouselSources();
      res.json({ success: true, message: "代理已删除，对应直播源已移除" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/carousel-proxies/batch-delete", (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "Missing ids array" });
    }
    try {
      const placeholders = ids.map(() => '?').join(',');
      const proxies = db.prepare(`SELECT id, platform, urlTemplate FROM carousel_proxies WHERE id IN (${placeholders})`).all(...ids) as any[];
      const nowStr = new Date().toISOString();
      const insertDeleted = db.prepare('INSERT OR REPLACE INTO deleted_carousel_proxies (urlTemplate, deletedAt) VALUES (?, ?)');
      const deleteStmt = db.prepare('DELETE FROM carousel_proxies WHERE id = ?');
      
      const tx = db.transaction((idList: string[]) => {
        for (const id of idList) {
          const proxy = proxies.find(p => p.id === id);
          if (proxy && proxy.urlTemplate) {
            try {
              insertDeleted.run(proxy.urlTemplate, nowStr);
            } catch (e) {}
          }
          deleteStmt.run(id);
        }
      });
      tx(ids);

      // Remove all corresponding live stream sources
      removeSourcesForProxyTemplates(proxies);
      syncCarouselSources();

      res.json({ success: true, count: ids.length, message: `已批量删除 ${ids.length} 个代理，对应直播源已移除` });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
  
  app.post("/api/carousel/test-all", async (req, res) => {
    try {
      const proxies = db.prepare('SELECT * FROM carousel_proxies').all() as any[];
      if (proxies.length === 0) {
        return res.json({ success: true, count: 0, results: [] });
      }
      
      const results: any[] = [];
      const fetchPromises = proxies.map(async (proxy) => {
        const testRes = await testCarouselProxyAvailability(proxy);
        if (testRes.available) {
          results.push({ templateId: proxy.id, platform: proxy.platform, url: proxy.urlTemplate, status: 'active', latency: testRes.latency });
          db.prepare('UPDATE carousel_proxies SET status = ? WHERE id = ?').run('active', proxy.id);
        } else {
          results.push({ templateId: proxy.id, platform: proxy.platform, url: proxy.urlTemplate, status: 'inactive', latency: null, error: testRes.error });
          db.prepare('UPDATE carousel_proxies SET status = ? WHERE id = ?').run('inactive', proxy.id);
        }
      });
      
      await Promise.all(fetchPromises);
      syncCarouselSources();
      res.json({ success: true, count: proxies.length, results });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Test carousel proxies for a specific channel
  app.post("/api/carousel/test", async (req, res) => {
    const { channelId, platform, originalId } = req.body;
    if (!channelId || !platform || !originalId) {
       return res.status(400).json({ error: "Missing required fields" });
    }
    
    try {
      // 1. Get ALL templates for this platform
      const templates = db.prepare('SELECT * FROM carousel_proxies WHERE platform = ?').all(platform) as any[];
      if (templates.length === 0) {
         return res.json({ success: true, count: 0, tested: 0, results: [] });
      }
      
      // 2. Generate URLs
      const urlsToTest = templates.map(t => ({
         templateId: t.id,
         url: t.urlTemplate.replace('{}', originalId)
      }));
      
      // 3. Test URLs
      const results = [];
      const fetchPromises = urlsToTest.map(async (item) => {
         try {
           const controller = new AbortController();
           const timeoutId = setTimeout(() => controller.abort(), 3000);
           const start = Date.now();
           const response = await fetch(item.url, { 
             method: 'GET',
             signal: controller.signal,
             headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
             }
           });
           clearTimeout(timeoutId);
           const latency = Date.now() - start;
           
           if (response.ok) {
              results.push({ ...item, status: 'active', latency });
              db.prepare('UPDATE carousel_proxies SET status = ? WHERE id = ?').run('active', item.templateId);
           } else {
              results.push({ ...item, status: 'inactive', latency: null });
              db.prepare('UPDATE carousel_proxies SET status = ? WHERE id = ?').run('inactive', item.templateId);
           }
         } catch (e) {
            results.push({ ...item, status: 'inactive', latency: null });
         }
      });
      
      await Promise.allSettled(fetchPromises);
      
      // 4. Save active results as new sources for the channel
      const activeResults = results.filter(r => r.status === 'active');
      const now = new Date().toISOString();
      const insertStmt = db.prepare('INSERT INTO sources (id, channelId, url, status, latency, lastChecked) VALUES (?, ?, ?, ?, ?, ?)');
      
      const insertMany = db.transaction((activeRes) => {
         for (const res of activeRes) {
            // Check if exists
            const exists = db.prepare('SELECT id FROM sources WHERE channelId = ? AND url = ?').get(channelId, res.url);
            if (!exists) {
               insertStmt.run(crypto.randomUUID(), channelId, res.url, 'active', res.latency, now);
            }
         }
      });
      
      insertMany(activeResults);
      
      res.json({ success: true, count: activeResults.length, tested: templates.length, results });
    } catch (e) {
      console.error('Carousel test error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/test-reports", (req, res) => {
    try {
      const reports = db.prepare("SELECT id, createdAt, totalTested, activeCount, inactiveCount, clientIsp, clientProvince FROM test_reports ORDER BY createdAt DESC LIMIT 50").all();
      res.json(reports);
    } catch (e) {
      console.error(e);
      res.json([]);
    }
  });

  app.get("/api/test-reports/:id", (req, res) => {
    try {
      const report = db.prepare("SELECT * FROM test_reports WHERE id = ?").get(req.params.id) as any;
      if (report) {
        report.details = JSON.parse(report.details);
        res.json(report);
      } else {
        res.status(404).json({ error: "Not found" });
      }
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/test-reports/:id", (req, res) => {
    try {
      db.prepare("DELETE FROM test_reports WHERE id = ?").run(req.params.id);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/sources/test-status", (req, res) => {
    res.json({ ...testStatus, lastDataUpdate: globalLastDataUpdate });
  });

  // Detect client IP information (ISP and Province) with robust multi-source fallbacks
  app.get("/api/sources/detect-ip", async (req, res) => {
    try {
      let clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "127.0.0.1";
      if (Array.isArray(clientIp)) {
        clientIp = clientIp[0];
      }
      if (typeof clientIp === "string" && clientIp.includes(",")) {
        clientIp = clientIp.split(",")[0].trim();
      }
      
      if (clientIp === "::1" || clientIp === "::ffff:127.0.0.1") {
        clientIp = "127.0.0.1";
      }

      let detectedIp = clientIp as string;
      let province = "北京";
      let isp = "电信";

      // 1. If it's a valid public IP, try getClientIpGeo first
      if (detectedIp && detectedIp !== "127.0.0.1") {
        try {
          const geo = await getClientIpGeo(detectedIp);
          if (geo && (geo.province || geo.isp)) {
            return res.json({
              ip: detectedIp,
              province: geo.province || "北京",
              isp: geo.isp || "电信"
            });
          }
        } catch (e) {
          // ignore
        }
      }

      // 2. Try external services with safe text/json parsing (pconline, ip-api, bilibili, cip.cc)
      const queryIp = detectedIp === "127.0.0.1" ? "" : detectedIp;
      
      // Try pconline (stable in CN, no strict rate limit)
      try {
        const pcRes = await fetch(`https://whois.pconline.com.cn/ipJson.jsp?ip=${queryIp}&json=true`, {
          signal: AbortSignal.timeout(3000)
        });
        if (pcRes.ok) {
          const rawBuffer = await pcRes.arrayBuffer();
          let rawText = "";
          try {
            rawText = new TextDecoder("gbk").decode(rawBuffer);
          } catch {
            rawText = new TextDecoder("utf-8").decode(rawBuffer);
          }
          if (rawText && rawText.includes("{")) {
            const data = JSON.parse(rawText.trim());
            if (data && data.ip) detectedIp = data.ip;
            if (data && data.pro) {
              province = data.pro.replace(/(省|市|特别行政区|自治区|壮族自治区|回族自治区|维吾尔自治区|盟)/g, "");
            }
            const addr = (data.addr || "").toLowerCase();
            if (addr.includes("电信")) isp = "电信";
            else if (addr.includes("联通")) isp = "联通";
            else if (addr.includes("移动")) isp = "移动";
            else if (addr.includes("广电")) isp = "广电";
            else if (addr.includes("铁通")) isp = "铁通";
            return res.json({ ip: detectedIp, province, isp });
          }
        }
      } catch (e) {
        // continue to next provider
      }

      // Try ip-api.com safely (checking content-type / rate limits)
      try {
        const url = `http://ip-api.com/json/${queryIp}?lang=zh-CN`;
        const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
        const rawText = await response.text();
        if (rawText && !rawText.includes("Rate exceeded") && rawText.trim().startsWith("{")) {
          const data = JSON.parse(rawText);
          if (data && data.status === "success") {
            detectedIp = data.query || detectedIp;
            if (data.regionName) {
              province = data.regionName.replace(/(省|市|特别行政区|自治区|壮族自治区|回族自治区|维吾尔自治区|盟)/g, "");
            }
            const rawIsp = (data.isp || data.org || "").toLowerCase();
            if (rawIsp.includes("telecom") || rawIsp.includes("chinanet") || rawIsp.includes("电信")) {
              isp = "电信";
            } else if (rawIsp.includes("unicom") || rawIsp.includes("联通")) {
              isp = "联通";
            } else if (rawIsp.includes("mobile") || rawIsp.includes("cmcc") || rawIsp.includes("移动")) {
              isp = "移动";
            } else if (rawIsp.includes("broadband") || rawIsp.includes("cable") || rawIsp.includes("广电") || rawIsp.includes("wasu")) {
              isp = "广电";
            } else {
              if (rawIsp.includes("china mobile")) isp = "移动";
              else if (rawIsp.includes("china unicom")) isp = "联通";
              else if (rawIsp.includes("china telecom")) isp = "电信";
              else isp = "其它";
            }
            return res.json({ ip: detectedIp, province, isp });
          }
        }
      } catch (e) {
        // continue to fallback
      }
      
      res.json({ ip: detectedIp, province, isp });
    } catch (err: any) {
      console.error("[IP Detect ERROR]:", err.message);
      res.json({ ip: "127.0.0.1", province: "北京", isp: "电信" });
    }
  });

  // Stop running batch test
  app.post("/api/sources/test-cancel", (req, res) => {
    if (testStatus.status === "running") {
      testStatus.status = "idle";
      res.json({ success: true, message: "测试已中断" });
    } else {
      res.json({ success: true, message: "当前没有正在运行的测试任务" });
    }
  });

  // EPG Mapping Status
  app.get("/api/epg/mapping-status", (req, res) => {
    const activeEpgSrcs = epgSources.filter(s => s.active);
    
    let epgTotalChannels = 0;
    const uniqueIds = new Set<string>();
    for (const src of activeEpgSrcs) {
      const cache = getEpgCache(src.id);
      if (cache && cache.raw) {
        Object.keys(cache.raw).forEach(k => uniqueIds.add(k));
      }
    }
    epgTotalChannels = uniqueIds.size;

    const mappedChannels: any[] = [];
    const unmappedChannels: any[] = [];

    for (const ch of channels) {
      let matchedEntry: EpgEntry | null = null;
      let matchedSourceName = "";
      let matchedOriginalId = "";

      for (const src of activeEpgSrcs) {
        const cache = getEpgCache(src.id);
        if (cache) {
          const entry = findMatchingEpgEntry(ch, cache);
          if (entry) {
            matchedEntry = entry;
            matchedSourceName = src.name;
            // Find the original XML id for this entry
            for (const [key, val] of Object.entries(cache.raw)) {
              if (val === entry) {
                matchedOriginalId = key;
                break;
              }
            }
            break;
          }
        }
      }

      if (matchedEntry) {
        mappedChannels.push({
          id: ch.id,
          name: ch.name,
          epgId: ch.epgId,
          matchedId: matchedOriginalId,
          matchedName: matchedEntry.displayNames[0] || matchedOriginalId,
          sourceName: matchedSourceName
        });
      } else {
        unmappedChannels.push({
          id: ch.id,
          name: ch.name,
          epgId: ch.epgId
        });
      }
    }

    res.json({
      epgTotalChannels,
      mappedChannels,
      unmappedChannels
    });
  });

  // EPG Generator Timeline Helper
  // Yields simulated EPG guide timelines for Chinese Television stations
  app.get("/api/epg/guide", (req, res) => {
    const { channelId, date } = req.query;
    const targetDate = date ? String(date) : new Date().toISOString().split("T")[0];

    const getEpgForChannelAndDate = (ch: Channel) => {
      const activeEpgSrcs = epgSources.filter(s => s.active);
      let bestPrograms: any[] = [];
      for (const src of activeEpgSrcs) {
        const cache = getEpgCache(src.id);
        if (cache) {
          const entry = findMatchingEpgEntry(ch, cache);
          if (entry && entry.programs && entry.programs.length > 0) {
            const filtered = entry.programs.filter((p: any) => {
              const parsed = parseXmltvTime(p.start);
              return parsed.dateStr === targetDate;
            }).map((p: any) => {
              const parsed = parseXmltvTime(p.start);
              return {
                time: parsed.timeStr,
                title: p.title
              };
            });
            if (filtered.length > bestPrograms.length) {
              filtered.sort((a: any, b: any) => a.time.localeCompare(b.time));
              bestPrograms = filtered;
            }
          }
        }
      }
      if (bestPrograms.length > 0) {
        return bestPrograms;
      }
      return [];
    };

    if (channelId) {
      const channel = channels.find((c) => c.id === channelId);
      if (channel) {
        return res.json({
          channelId,
          channelName: channel.name,
          date: targetDate,
          epgId: channel.epgId,
          isSimulated: false,
          programs: getEpgForChannelAndDate(channel),
        });
      }
    }

    // Yield mappings for all matched channels
    const guideMap = channels.map((c) => ({
      channelId: c.id,
      channelName: c.name,
      epgId: c.epgId,
      programs: getEpgForChannelAndDate(c),
    }));

    res.json({ date: targetDate, guides: guideMap });
  });

  // AI Smart Auto-Correction Recommendation Endpoint
  app.post("/api/epg/ai-recommend", async (req, res) => {
    try {
      const { channelId, channelName } = req.body;
      let targetName = "";
      if (channelId) {
        const found = channels.find(c => c.id === channelId);
        if (found) {
          targetName = found.name;
        }
      }
      if (!targetName && channelName) {
        targetName = String(channelName).trim();
      }

      if (!targetName) {
        return res.status(400).json({ error: "缺少频道名称或频道ID" });
      }

      // 1. Gather all candidates from active EPG sources
      const candidates: { epgId: string; displayNames: string[]; sourceName: string }[] = [];
      const seenIds = new Set<string>();

      const activeEpgSrcs = epgSources.filter(s => s.active);
      for (const src of activeEpgSrcs) {
        const cache = getEpgCache(src.id);
        if (cache) {
          for (const [epgId, entry] of Object.entries(cache.raw)) {
            const key = `${src.id}::${epgId}`;
            if (!seenIds.has(key)) {
              seenIds.add(key);
              candidates.push({
                epgId,
                displayNames: entry.displayNames || [],
                sourceName: src.name
              });
            }
          }
        }
      }

      // 2. Score and sort candidates to get the top 100
      const scoreCand = (name: string, cand: { epgId: string; displayNames: string[] }) => {
        const normTarget = name.toLowerCase().replace(/[\s\-hd高超清蓝光]/g, "");
        let maxScore = 0;

        const checkText = (text: string) => {
          const normText = text.toLowerCase().replace(/[\s\-hd高超清蓝光]/g, "");
          if (!normText || !normTarget) return 0;
          if (normText === normTarget) return 100;
          if (normTarget.includes(normText) || normText.includes(normTarget)) {
            return 50 + Math.min(normText.length, normTarget.length) * 5;
          }
          const s1 = new Set(normTarget.split(""));
          const s2 = new Set(normText.split(""));
          let intersection = 0;
          for (const char of s1) {
            if (s2.has(char)) intersection++;
          }
          if (intersection > 0) {
            return (intersection / Math.max(s1.size, s2.size)) * 40;
          }
          return 0;
        };

        maxScore = Math.max(maxScore, checkText(cand.epgId));
        if (cand.displayNames) {
          for (const display of cand.displayNames) {
            maxScore = Math.max(maxScore, checkText(display));
          }
        }
        return maxScore;
      };

      const scoredList = candidates
        .map(c => ({ candidate: c, score: scoreCand(targetName, c) }))
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 100)
        .map(x => x.candidate);

      // 3. Get Gemini Client and generate content
      const ai = getGeminiClient();

      const prompt = `你是一个智能IPTV电视频道匹配专家。
我们正在为用户导入的频道：【${targetName}】匹配最合适的 EPG (电子节目单) ID。

下面是从当前已被激活的 EPG 节目源里筛选出的匹配候选列表（包含 epgId、displayNames、及来源Epg源名）：
${JSON.stringify(scoredList.map(c => ({ epgId: c.epgId, names: c.displayNames, src: c.sourceName })), null, 2)}

请根据：
1. 名字同义性（例如 CCTV-5 对应 CCTV5 或者 体育台，广东体育 对应 粤语体育）
2. 缩写和官方标准（例如 CCTV1 代表 Central China Television Channel 1，或者 湖南卫视 对应 Hunan-TV）
3. 剔除噪声（如 HD, 高清, 超清 等分辨率标识不影响频道属性）

请在候选项目中，选出最完美最精准的前 3 个推荐推荐。
如果候选列表没有完美匹配，请在 EPG 的标准命名规范下（如“cctv1”, “hunantv”等）推荐一个最合理的 EPG ID。并且说明这是非候选项目的常识性推荐。

请精确按照以下 JSON Schema 返回数据：
[
  {
    "epgId": "推荐匹配的 epgId",
    "displayName": "该 epgId 的代表名称 (例如 湖南卫视)",
    "reason": "推荐理由简短中文",
    "confidence": 0.95 // 匹配置信度，范围 0.0 到 1.0
  }
]`;

      const geminiRes = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                epgId: { type: Type.STRING },
                displayName: { type: Type.STRING },
                reason: { type: Type.STRING },
                confidence: { type: Type.NUMBER }
              },
              required: ["epgId", "displayName", "reason", "confidence"]
            }
          }
        }
      });

      const responseText = geminiRes.text;
      if (!responseText) {
        throw new Error("模型未返回任何结果");
      }

      const results = JSON.parse(responseText.trim());
      res.json({ success: true, channelName: targetName, recommendations: results });
    } catch (err: any) {
      console.error("[EPG AI RECOMMEND ERROR]", err.message || err);
      res.status(500).json({ error: err.message || "智能匹配推荐失败，请检查 API Key 配置" });
    }
  });

  // CUSTOM EXPORTS/PLAYBACK API INTERFACE
  // Third-party players consume this!
  // Example usage: http://localhost:3000/api/export/m3u?isp=电信&status=active
  // Example usage: http://localhost:3000/api/export/txt?province=北京
  app.get("/api/export/m3u", async (req, res) => {
    const { category, isp, province, status, limit, maxPerChannel: queryMaxPerChannel, ip, clientIp, v } = req.query;

    let targetProvince = province ? String(province) : "";
    let targetIsp = isp ? String(isp) : "";

    // If province/isp not explicitly provided, detect from IP
    let resolvedClientIp = "";
    if (!province && !isp) {
      if (typeof ip === "string" && ip) {
        resolvedClientIp = ip;
      } else if (typeof clientIp === "string" && clientIp) {
        resolvedClientIp = clientIp;
      } else if (typeof req.headers["x-forwarded-for"] === "string") {
        resolvedClientIp = req.headers["x-forwarded-for"].split(",")[0].trim();
      } else if (Array.isArray(req.headers["x-forwarded-for"])) {
        resolvedClientIp = req.headers["x-forwarded-for"][0].trim();
      } else if (typeof req.headers["x-real-ip"] === "string") {
        resolvedClientIp = req.headers["x-real-ip"].trim();
      } else {
        resolvedClientIp = req.socket.remoteAddress || "";
      }

      if (resolvedClientIp) {
        const geo = await getClientIpGeo(resolvedClientIp);
        targetProvince = geo.province;
        targetIsp = geo.isp;
        console.log(`[EXPORT M3U AUTO-IP] Client IP ${resolvedClientIp} matched Province: ${targetProvince}, ISP: ${targetIsp}`);
      }
    }

    const host = req.headers.host || "localhost:3000";
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const baseUrl = `${protocol}://${host}`;

    const finalIsp = isp ? String(isp) : targetIsp;
    const finalProvince = province ? String(province) : targetProvince;

    const cacheParams = {
      format: "m3u" as const,
      category: category ? String(category) : undefined,
      isp: finalIsp || undefined,
      province: finalProvince || undefined,
      status: status ? String(status) : undefined,
      limit: limit ? String(limit) : undefined,
      maxPerChannel: queryMaxPerChannel ? String(queryMaxPerChannel) : undefined,
      baseUrl,
      v: m3uLogoVersion || undefined
    };

    const { content, etag } = getOrGeneratePlaylistExport(cacheParams, () => {
      let playlistRows = [`#EXTM3U x-tvg-url="${baseUrl}/api/export/epg.xml.gz"`];
      let count = 0;
      const maxLimit = limit ? Number(limit) : Infinity;
      const maxPerChannel = queryMaxPerChannel ? Number(queryMaxPerChannel) : 15;
      const versionString = m3uLogoVersion || "";

      const orderedGroups = [...groups, { id: "g_other", name: "其它频道" }];
      orderedGroups.forEach((group) => {
        if (group.isolated) return;
        channels.forEach((channel) => {
          if (channel.isolated) return;
          const isInGroup = channel.groupIds.includes(group.id);
          const isFallback = group.id === "g_other" && (channel.groupIds.length === 0 || !channel.groupIds.some(id => groups.find(g => g.id === id)));
          if (!isInGroup && !isFallback) return;
          const gId = group.id;
          const groupName = group.name;

          // Filter group level if specific category selected
          if (category && groupName !== String(category) && gId !== String(category)) return;

          let processedSources = channel.sources;

          processedSources = getPlayableSources(processedSources, finalIsp, finalProvince);

          if (province) {
            processedSources = processedSources.filter(source => source.province === String(province));
          }

          // Default: exclude inactive and unknown/checking sources if status is not explicitly asked for
          if (!status) {
            processedSources = processedSources.filter(source => source.status === "active");
          } else if (status) {
            processedSources = processedSources.filter(source => source.status === String(status));
          }

          // Prioritize active, RTSP protocol, and lowest latency
          processedSources = sortSourcesForExport(processedSources);

          // 限制每个频道最大输出数量 (Limit max sources per channel)
          const sourcesToExport = processedSources.slice(0, maxPerChannel);
          sourcesToExport.forEach(bestSource => {
            if (count >= maxLimit) return;

            const channelDisplayName = channel.name;
            let logoUrl = channel.logo || "";
            if (logoUrl && versionString) {
              logoUrl += (logoUrl.includes("?") ? "&v=" : "?v=") + versionString;
            }
            
            playlistRows.push(
              `#EXTINF:-1 tvg-id="${channel.epgId}" tvg-name="${channel.name}" tvg-logo="${logoUrl}" group-title="${groupName}",${channelDisplayName}`
            );
            playlistRows.push(bestSource.url);
            count++;
          });
        });
      });
      return playlistRows.join("\n");
    });

    if (req.headers["if-none-match"] === etag) {
      return res.status(304).end();
    }

    res.setHeader("Content-Type", "application/x-mpegurl; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="iptv_custom.m3u"');
    res.setHeader("Cache-Control", "public, max-age=1800");
    res.setHeader("ETag", etag);
    res.setHeader("X-Client-IP", resolvedClientIp || "");
    res.setHeader("X-Client-ISP", encodeURIComponent(targetIsp || ""));
    res.setHeader("X-Client-Province", encodeURIComponent(targetProvince || ""));
    const m3uDebugHeader = `\n# [Debug Info] Client IP: ${resolvedClientIp || "N/A"} | Detected ISP: ${targetIsp || "None"} | Detected Province: ${targetProvince || "None"}`;
    const firstLineEnd = content.indexOf("\n");
    if (firstLineEnd !== -1) {
      res.send(content.slice(0, firstLineEnd) + m3uDebugHeader + content.slice(firstLineEnd));
    } else {
      res.send(content + m3uDebugHeader);
    }
  });

  // TXT (TVBox compatible) format
  app.get("/api/export/txt", async (req, res) => {
    const { category, isp, province, status, limit, maxPerChannel: queryMaxPerChannel, ip, clientIp } = req.query;

    let targetProvince = province ? String(province) : "";
    let targetIsp = isp ? String(isp) : "";

    // If province/isp not explicitly provided, detect from IP
    let resolvedClientIp = "";
    if (!province && !isp) {
      if (typeof ip === "string" && ip) {
        resolvedClientIp = ip;
      } else if (typeof clientIp === "string" && clientIp) {
        resolvedClientIp = clientIp;
      } else if (typeof req.headers["x-forwarded-for"] === "string") {
        resolvedClientIp = req.headers["x-forwarded-for"].split(",")[0].trim();
      } else if (Array.isArray(req.headers["x-forwarded-for"])) {
        resolvedClientIp = req.headers["x-forwarded-for"][0].trim();
      } else if (typeof req.headers["x-real-ip"] === "string") {
        resolvedClientIp = req.headers["x-real-ip"].trim();
      } else {
        resolvedClientIp = req.socket.remoteAddress || "";
      }

      if (resolvedClientIp) {
        const geo = await getClientIpGeo(resolvedClientIp);
        targetProvince = geo.province;
        targetIsp = geo.isp;
        console.log(`[EXPORT TXT AUTO-IP] Client IP ${resolvedClientIp} matched Province: ${targetProvince}, ISP: ${targetIsp}`);
      }
    }

    const finalIsp = isp ? String(isp) : targetIsp;
    const finalProvince = province ? String(province) : targetProvince;

    const cacheParams = {
      format: "txt" as const,
      category: category ? String(category) : undefined,
      isp: finalIsp || undefined,
      province: finalProvince || undefined,
      status: status ? String(status) : undefined,
      limit: limit ? String(limit) : undefined,
      maxPerChannel: queryMaxPerChannel ? String(queryMaxPerChannel) : undefined
    };

    const { content, etag } = getOrGeneratePlaylistExport(cacheParams, () => {
      const exportMap = new Map<string, string[]>();

      let count = 0;
      const maxLimit = limit ? Number(limit) : Infinity;
      const maxPerChannel = queryMaxPerChannel ? Number(queryMaxPerChannel) : 15;

      const orderedGroups = [...groups, { id: "g_other", name: "其它频道" }];
      orderedGroups.forEach((group) => {
        if (group.isolated) return;
        channels.forEach((channel) => {
          if (channel.isolated) return;
          const isInGroup = channel.groupIds.includes(group.id);
          const isFallback = group.id === "g_other" && (channel.groupIds.length === 0 || !channel.groupIds.some(id => groups.find(g => g.id === id)));
          if (!isInGroup && !isFallback) return;
          const gId = group.id;
          const groupName = group.name;

          if (category && groupName !== String(category) && gId !== String(category)) return;

          let processedSources = channel.sources;

          processedSources = getPlayableSources(processedSources, finalIsp, finalProvince);

          if (province) {
            processedSources = processedSources.filter(source => source.province === String(province));
          }

          // Default: exclude inactive and unknown/checking sources if status is not explicitly asked for
          if (!status) {
            processedSources = processedSources.filter(source => source.status === "active");
          } else if (status) {
            processedSources = processedSources.filter(source => source.status === String(status));
          }

          // Prioritize active, RTSP protocol, and lowest latency
          processedSources = sortSourcesForExport(processedSources);

          // 限制每个频道最大输出数量 (Limit max sources per channel)
          const sourcesToExport = processedSources.slice(0, maxPerChannel);
          sourcesToExport.forEach(bestSource => {
            if (count >= maxLimit) return;

            const catName = groupName;
            if (!exportMap.has(catName)) {
              exportMap.set(catName, []);
            }

            const channelDisplayStr = `${channel.name},${bestSource.url}`;
            
            exportMap.get(catName)!.push(channelDisplayStr);
            count++;
          });
        });
      });

      const fileRows: string[] = [];
      exportMap.forEach((lines, catName) => {
        fileRows.push(`${catName},#genre`);
        fileRows.push(...lines);
        fileRows.push(""); // empty spacing
      });
      return fileRows.join("\n");
    });

    if (req.headers["if-none-match"] === etag) {
      return res.status(304).end();
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="iptv_custom.txt"');
    res.setHeader("Cache-Control", "public, max-age=1800");
    res.setHeader("ETag", etag);
    res.setHeader("X-Client-IP", resolvedClientIp || "");
    res.setHeader("X-Client-ISP", encodeURIComponent(targetIsp || ""));
    res.setHeader("X-Client-Province", encodeURIComponent(targetProvince || ""));
    res.send(content);
  });

  app.get("/api/play/:channelName" , async (req, res) => {
    try {
      const channelName = req.params.channelName;
      const { isp, province } = req.query;
      
      let targetProvince = province ? String(province) : "";
      let targetIsp = isp ? String(isp) : "";
      
      // Auto detect client IP Geo if params are missing
      let resolvedClientIp = "";
      if (!province && !isp) {
        if (typeof req.query.ip === "string" && req.query.ip) {
          resolvedClientIp = req.query.ip;
        } else if (typeof req.headers["x-forwarded-for"] === "string") {
          resolvedClientIp = req.headers["x-forwarded-for"].split(",")[0].trim();
        } else if (Array.isArray(req.headers["x-forwarded-for"])) {
          resolvedClientIp = req.headers["x-forwarded-for"][0].trim();
        } else if (typeof req.headers["x-real-ip"] === "string") {
          resolvedClientIp = req.headers["x-real-ip"].trim();
        } else {
          resolvedClientIp = req.socket.remoteAddress || "";
        }
        
        if (resolvedClientIp) {
          const geo = await getClientIpGeo(resolvedClientIp);
          targetProvince = geo.province;
          targetIsp = geo.isp;
        }
      }
      
      // Normalize search
      const normalizedQuery = normalizeChannelName(channelName);
      const channel = channels.find(c => 
        normalizeChannelName(c.name) === normalizedQuery || 
        c.alias.some(a => normalizeChannelName(a) === normalizedQuery)
      );

      if (!channel || channel.isolated || !channel.sources || channel.sources.length === 0) {
        return res.status(404).send("Channel not found or isolated");
      }
      
      // Filter out isolated sources & filter by ISP via existing helper
      let processedSources = getPlayableSources(channel.sources, targetIsp, targetProvince);
      processedSources = processedSources.filter(s => s.status === "active");
      
      // Prioritize active, RTSP protocol, and lowest latency
      processedSources = sortSourcesForExport(processedSources);

      if (processedSources.length === 0) {
        // Fallback to channel sources just in case ISP filtering was too aggressive
        processedSources = sortSourcesForExport(channel.sources.filter(s => !s.isolated && s.status === "active"));
      }
      
      if (processedSources.length === 0) {
         return res.status(404).send("No valid non-isolated sources available");
      }
      
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.send(processedSources[0].url);
      
    } catch (e: any) {
      res.status(500).send("Error generating play URL: " + e.message);
    }
  });

  // Dynamic EPG XML TV interface
  // Returns generic valid XMLTV layout for connected players matching epgIds
  app.get("/api/export/epg.xml", (req, res) => {
    try {
      const { xml, etag } = getOrGenerateIntegratedEpgXml();
      if (req.headers["if-none-match"] === etag) {
        return res.status(304).end();
      }
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=1800");
      res.setHeader("ETag", etag);
      res.send(xml);
    } catch (err: any) {
      console.error("[EPG EXPORT ERROR]", err);
      res.status(500).send("Error generating EPG XML");
    }
  });

  // Compressed XML.GZ EPG feed with file cache and 304 Not Modified support
  app.get("/api/export/epg.xml.gz", (req, res) => {
    try {
      const { gz, etag } = getOrGenerateIntegratedEpgXml();
      if (req.headers["if-none-match"] === etag) {
        return res.status(304).end();
      }
      res.setHeader("Content-Type", "application/gzip");
      res.setHeader("Content-Disposition", 'attachment; filename="epg.xml.gz"');
      res.setHeader("Cache-Control", "public, max-age=1800");
      res.setHeader("ETag", etag);
      res.end(gz);
    } catch (err: any) {
      console.error("[EPG GZIP EXPORT ERROR]", err);
      res.status(500).send("Internal Server Error during compression");
    }
  });

  

  // Clean-up and optimization APIs
  app.post("/api/cleanup/duplicates", (req, res) => {
    let affectedCount = 0;
    channels.forEach((channel) => {
      const urlMap = new Set<string>();
      const uniqueSources: any[] = [];
      channel.sources.forEach((s) => {
        if (!urlMap.has(s.url)) {
          urlMap.add(s.url);
          uniqueSources.push(s);
        } else {
          affectedCount++;
        }
      });
      channel.sources = uniqueSources;
    });
    saveData();
    res.json({ success: true, message: `成功清理并物理移除了 ${affectedCount} 个完全重复的直播线路` });
  });

  app.post("/api/cleanup/inactive", (req, res) => {
    const { failThreshold } = req.body || {};
    const threshold = parseInt(failThreshold as string) || 0;

    let affectedCount = 0;
    let restoredRtspCount = 0;

    channels.forEach((channel) => {
      channel.sources.forEach((s) => {
        const isRtspOrIntranet = isPrivateOrIntranetUrl(s.url);

        if (isRtspOrIntranet) {
          const isExplicitlyTimeout = s.latency !== undefined && s.latency >= 9999;
          
          if (!isExplicitlyTimeout) {
            if (s.isolated) {
              s.isolated = false;
              restoredRtspCount++;
            }
            if (s.status === "inactive") {
              s.status = "active";
            }
            return; // Skip isolating RTSP / Intranet streams
          }
          // If it is a timeout (9999ms), fall through to normal cleanup/isolation logic
        }

        const isInvalid = s.status === "inactive" || (s.latency !== undefined && s.latency >= 9999);

        if (isInvalid && !s.isolated) {
          if (threshold > 0) {
            const failures = (s.testCount || 0) - (s.successCount || 0);
            if (failures < threshold && s.latency !== 9999 && s.status !== "inactive") {
              return; // Skip isolating if it hasn't failed enough times
            }
          }
          s.isolated = true;
          s.status = "inactive";
          affectedCount++;
        }
      });
    });

    saveData();
    let msg = `成功隔离 (软隐藏) ${affectedCount} 个失效链接直播源`;
    if (restoredRtspCount > 0) {
      msg += `，并自动恢复防卡死解隔离了 ${restoredRtspCount} 个 RTSP/内网源`;
    }
    res.json({ success: true, message: msg });
  });

  // Backup Parsing & Normalization Helper Functions
  function parseM3uToBackup(text: string) {
    const lines = text.split(/\r?\n/);
    const channelsMap = new Map<string, any>();
    const groupsMap = new Map<string, any>();
    
    let currentTitle = "";
    let currentGroup = "未分类";
    let currentLogo = "";
    let currentEpgId = "";

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      if (trimmed.startsWith("#EXTINF:")) {
        const groupMatch = trimmed.match(/group-title="([^"]+)"/i);
        const logoMatch = trimmed.match(/tvg-logo="([^"]+)"/i);
        const epgMatch = trimmed.match(/tvg-id="([^"]+)"/i);
        const commaIdx = trimmed.indexOf(",");
        
        currentGroup = groupMatch ? groupMatch[1] : "未分类";
        currentLogo = logoMatch ? logoMatch[1] : "";
        currentEpgId = epgMatch ? epgMatch[1] : "";
        currentTitle = commaIdx !== -1 ? trimmed.substring(commaIdx + 1).trim() : "";
      } else if (trimmed.includes(",#genre")) {
        const parts = trimmed.split(",");
        currentGroup = parts[0].trim() || "未分类";
      } else if (trimmed.includes("http://") || trimmed.includes("https://") || trimmed.includes("rtsp://") || trimmed.includes("rtmp://")) {
        let url = trimmed;
        let name = currentTitle;
        if (!name && trimmed.includes(",")) {
          const parts = trimmed.split(",");
          name = parts[0].trim();
          url = parts[1].trim();
        }
        if (!name) name = "未知频道";

        const groupKey = currentGroup || "未分类";
        if (!groupsMap.has(groupKey)) {
          groupsMap.set(groupKey, { id: `g_m3u_${groupsMap.size + 1}`, name: groupKey, isolated: false });
        }
        const grp = groupsMap.get(groupKey)!;

        if (!channelsMap.has(name)) {
          channelsMap.set(name, {
            id: `ch_m3u_${channelsMap.size + 1}_${Date.now()}`,
            name,
            logo: currentLogo,
            groupIds: [grp.id],
            alias: [],
            epgId: currentEpgId,
            isolated: false,
            sources: []
          });
        }
        const ch = channelsMap.get(name)!;
        ch.sources.push({
          id: `src_m3u_${ch.sources.length + 1}_${Date.now()}`,
          url,
          status: "active",
          isolated: false
        });

        currentTitle = "";
      }
    });

    return {
      channels: Array.from(channelsMap.values()),
      groups: Array.from(groupsMap.values()),
      syncConfigs: [],
      epgSources: []
    };
  }

  function parseAndNormalizeBackup(rawInput: any): any {
    let parsed: any = null;

    if (Buffer.isBuffer(rawInput) || rawInput instanceof Uint8Array) {
      if (rawInput.length >= 2 && rawInput[0] === 0x1f && rawInput[1] === 0x8b) {
        try {
          const uncompressed = zlib.gunzipSync(rawInput);
          return parseAndNormalizeBackup(uncompressed.toString("utf-8"));
        } catch (e) {
          return parseAndNormalizeBackup(rawInput.toString("utf-8"));
        }
      } else {
        return parseAndNormalizeBackup(rawInput.toString("utf-8"));
      }
    }

    if (typeof rawInput === "string") {
      const trimmed = rawInput.trim();
      if (!trimmed.startsWith("{") && !trimmed.startsWith("[") && !trimmed.startsWith("#") && trimmed.length > 20) {
        try {
          const decoded = Buffer.from(trimmed, "base64");
          if (decoded.length >= 2 && decoded[0] === 0x1f && decoded[1] === 0x8b) {
            const uncompressed = zlib.gunzipSync(decoded);
            return parseAndNormalizeBackup(uncompressed.toString("utf-8"));
          }
        } catch (e) {}
      }

      try {
        parsed = JSON.parse(trimmed);
      } catch (e) {
        if (trimmed.includes("#EXTM3U") || trimmed.includes("#EXTINF") || trimmed.includes(",http")) {
          return parseM3uToBackup(trimmed);
        }
        throw new Error("备份文件解析失败：既不是有效的 JSON 格式，也不是可解析的 M3U/TXT 播放列表");
      }
    } else if (typeof rawInput === "object" && rawInput !== null) {
      parsed = rawInput;
    }

    if (!parsed) {
      throw new Error("无效的备份文件内容");
    }

    if (parsed.data && typeof parsed.data === "object") parsed = parsed.data;
    else if (parsed.backup && typeof parsed.backup === "object") parsed = parsed.backup;
    else if (parsed.result && typeof parsed.result === "object") parsed = parsed.result;
    else if (parsed.content && typeof parsed.content === "object") parsed = parsed.content;

    if (Array.isArray(parsed)) {
      const channels: any[] = [];
      const groups: any[] = [{ id: "g_imported", name: "导入备份", isolated: false }];
      parsed.forEach((item, idx) => {
        if (item && typeof item === "object") {
          const chId = item.id || `ch_imp_${idx}_${Date.now()}`;
          const chName = item.name || item.title || `频道 ${idx + 1}`;
          let sources: any[] = [];
          if (Array.isArray(item.sources)) {
            sources = item.sources;
          } else if (item.url) {
            sources = [{ id: `src_imp_${idx}_1`, url: item.url, status: "active", isolated: false }];
          }
          channels.push({
            id: chId,
            name: chName,
            logo: item.logo || "",
            groupIds: item.groupIds || ["g_imported"],
            alias: item.alias || [],
            epgId: item.epgId || "",
            isolated: !!item.isolated,
            sources
          });
        }
      });
      return { channels, groups, syncConfigs: [], epgSources: [] };
    }

    const resultObj: any = {
      channels: Array.isArray(parsed.channels) ? parsed.channels : [],
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      syncConfigs: Array.isArray(parsed.syncConfigs) ? parsed.syncConfigs : [],
      epgSources: Array.isArray(parsed.epgSources) ? parsed.epgSources : [],
    };

    if (parsed.adminPassword !== undefined) resultObj.adminPassword = parsed.adminPassword;
    if (parsed.githubProxy !== undefined) resultObj.githubProxy = parsed.githubProxy;
    if (parsed.autoCreateChannel !== undefined) resultObj.autoCreateChannel = parsed.autoCreateChannel;
    if (parsed.cronJobs && Array.isArray(parsed.cronJobs)) resultObj.cronJobs = parsed.cronJobs;

    if (Array.isArray(parsed.carouselProxies)) resultObj.carouselProxies = parsed.carouselProxies;
    if (Array.isArray(parsed.deletedCarouselProxies)) resultObj.deletedCarouselProxies = parsed.deletedCarouselProxies;
    if (Array.isArray(parsed.carouselChannels)) resultObj.carouselChannels = parsed.carouselChannels;
    if (Array.isArray(parsed.carouselDiscoveryRules)) resultObj.carouselDiscoveryRules = parsed.carouselDiscoveryRules;
    if (Array.isArray(parsed.carouselDisabledRules)) resultObj.carouselDisabledRules = parsed.carouselDisabledRules;

    if (
      resultObj.channels.length === 0 &&
      resultObj.groups.length === 0 &&
      resultObj.syncConfigs.length === 0 &&
      resultObj.epgSources.length === 0 &&
      (!resultObj.carouselChannels || resultObj.carouselChannels.length === 0) &&
      (!resultObj.carouselProxies || resultObj.carouselProxies.length === 0)
    ) {
      throw new Error("备份文件中未包含任何可识别的频道、分组、订阅源、EPG 或轮播代理数据节点");
    }

    return resultObj;
  }

  // DB Manual Backup & Restore APIs
  app.get("/api/backups", (req, res) => {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        return res.json({ success: true, backups: [] });
      }
      const files = fs.readdirSync(DATA_DIR);
      const backupFiles = files
        .filter((f) => f.startsWith("iptv_data_backup_") && (f.endsWith(".json") || f.endsWith(".json.gz")));
      
      const backups = backupFiles.map((filename) => {
        const filePath = path.join(DATA_DIR, filename);
        const stat = fs.statSync(filePath);
        let size = stat.size;
        let channelCount = 0;
        let groupCount = 0;
        let tag = "自动备份";
        let isManual = false;
        
        if (filename.includes("_manual_") || filename.includes("_manual")) {
          isManual = true;
          tag = "手动备份";
        }
        
        try {
          let content = "";
          if (filename.endsWith(".json.gz")) {
             content = zlib.gunzipSync(fs.readFileSync(filePath)).toString("utf-8");
          } else {
             content = fs.readFileSync(filePath, "utf-8");
          }
          const parsed = JSON.parse(content);
          channelCount = parsed.channels ? parsed.channels.length : 0;
          groupCount = parsed.groups ? parsed.groups.length : 0;
          if (parsed.backupMeta && parsed.backupMeta.tag) {
            tag = parsed.backupMeta.tag;
            isManual = true;
          }
        } catch (e) {
          // Ignored
        }
        
        return {
          filename,
          createdAt: stat.mtime || stat.birthtime,
          size,
          type: isManual ? "manual" : "auto",
          tag,
          channelCount,
          groupCount
        };
      });
      
      // Sort newest first based on actual file modification time
      backups.sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
      
      res.json({ success: true, backups });
    } catch (err: any) {
      res.status(500).json({ error: "获取备份列表失败: " + err.message });
    }
  });

  app.post("/api/backups", (req, res) => {
    try {
      const { tag } = req.body;
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      
      const safeTag = tag ? tag.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "").substring(0, 20) : "手动备份";
      const filename = `iptv_data_backup_manual_${timestamp}.json.gz`;
      const filePath = path.join(DATA_DIR, filename);
      
      const cronJobsData = db.prepare("SELECT * FROM cron_jobs").all();
      const backupContent = {
        groups,
        channels,
        syncConfigs,
        epgSources,
        cronJobs: cronJobsData,
        carouselProxies: db.prepare("SELECT * FROM carousel_proxies").all(),
        deletedCarouselProxies: db.prepare("SELECT * FROM deleted_carousel_proxies").all(),
        carouselChannels: db.prepare("SELECT * FROM carousel_channels").all(),
        carouselDiscoveryRules: db.prepare("SELECT * FROM carousel_discovery_rules").all(),
        carouselDisabledRules: db.prepare("SELECT * FROM carousel_disabled_rules").all(),
        adminPassword,
        githubProxy,
        autoCreateChannel,
        backupMeta: {
          tag: safeTag,
          createdAt: now.toISOString(),
          type: "manual"
        }
      };
      
      fs.writeFileSync(filePath, zlib.gzipSync(Buffer.from(JSON.stringify(backupContent, null, 2), "utf-8")));
      res.json({ success: true, message: "备份已成功创建", filename, tag: safeTag });
    } catch (err: any) {
      res.status(500).json({ error: "创建备份失败: " + err.message });
    }
  });

  app.post("/api/backups/restore", (req, res) => {
    try {
      const { filename, content } = req.body;
      
      // Save current database as prior backup to prevent accidental loss
      const autoBackupName = `iptv_data_backup_before_restore_${Date.now()}.json.gz`;
      try {
        const priorBackupJson = {
          groups,
          channels,
          syncConfigs,
          epgSources,
          carouselProxies: db.prepare("SELECT * FROM carousel_proxies").all(),
          deletedCarouselProxies: db.prepare("SELECT * FROM deleted_carousel_proxies").all(),
          carouselChannels: db.prepare("SELECT * FROM carousel_channels").all(),
          carouselDiscoveryRules: db.prepare("SELECT * FROM carousel_discovery_rules").all(),
          carouselDisabledRules: db.prepare("SELECT * FROM carousel_disabled_rules").all(),
          adminPassword,
          githubProxy,
        };
        fs.writeFileSync(path.join(DATA_DIR, autoBackupName), zlib.gzipSync(Buffer.from(JSON.stringify(priorBackupJson, null, 2), "utf-8")));
      } catch (backupErr) {
        console.error("[Restore Backup] Failed to write safety prior backup:", backupErr);
      }

      let parsedBackupData: any = null;

      if (content) {
        try {
          parsedBackupData = parseAndNormalizeBackup(content);
        } catch (e: any) {
          return res.status(400).json({ error: "备份文件解析失败: " + e.message });
        }
      } else if (filename) {
        const safeFilename = path.basename(filename);
        const filePath = path.join(DATA_DIR, safeFilename);
        if (!fs.existsSync(filePath)) {
          return res.status(404).json({ error: "未找到指定的备份文件: " + safeFilename });
        }
        try {
          let rawData: Buffer | string = "";
          if (filePath.endsWith(".json.gz")) {
            rawData = zlib.gunzipSync(fs.readFileSync(filePath));
          } else {
            rawData = fs.readFileSync(filePath, "utf-8");
          }
          parsedBackupData = parseAndNormalizeBackup(rawData);
        } catch (e: any) {
          return res.status(500).json({ error: "解析本地备份文件失败: " + e.message });
        }
      } else {
        return res.status(400).json({ error: "参数错误: filename 或者是备份内容 (content) 不能为空" });
      }

      fs.writeFileSync(DATA_FILE, JSON.stringify(parsedBackupData, null, 2), "utf-8");
      loadData();
      saveDataSync(); // Force immediate persistence to SQLite

      const chCount = parsedBackupData.channels ? parsedBackupData.channels.length : 0;
      const grpCount = parsedBackupData.groups ? parsedBackupData.groups.length : 0;

      return res.json({
        success: true,
        message: `成功完成恢复！共载入 ${chCount} 个频道和 ${grpCount} 个分组。原有数据已自动为您归档为：${autoBackupName}`,
        autoBackupName,
        channelCount: chCount,
        groupCount: grpCount
      });
    } catch (err: any) {
      res.status(500).json({ error: "恢复备份失败: " + err.message });
    }
  });

  app.delete("/api/backups/:filename", (req, res) => {
    try {
      const filename = path.basename(req.params.filename);
      const filePath = path.join(DATA_DIR, filename);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "未找到指定的备份文件" });
      }
      fs.unlinkSync(filePath);
      res.json({ success: true, message: "备份已成功删除" });
    } catch (err: any) {
      res.status(500).json({ error: "删除备份失败: " + err.message });
    }
  });

  app.get("/api/backups/download/:filename", (req, res) => {
    try {
      const filename = path.basename(req.params.filename);
      const filePath = path.join(DATA_DIR, filename);
      if (!fs.existsSync(filePath)) {
        return res.status(440).send("File not found");
      }
      res.download(filePath, filename);
    } catch (err: any) {
      res.status(500).send("下载备份文件发生错误: " + err.message);
    }
  });

  // Build Vite Middleware Setup
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serves static bundle in Production
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Bind to PORT 3000 and 0.0.0.0
  app.listen(PORT, "0.0.0.0", () => {
    preGenerateIspPlaylists();
    console.log(`Server loaded with ${channels.length} channels, running on http://localhost:${PORT}`);
  });
}

startServer();
